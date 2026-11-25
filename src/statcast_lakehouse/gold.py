"""Gold: pitcher-level marts, ported from stat-cast's dbt models to Spark SQL.

Each mart reads silver (registered as the view `fct_pitches`) and `dim_pitchers`.
The SQL stays close to the dbt originals; the Postgres-only bits changed:
`::numeric` casts are gone, `distinct on` became a row_number().
"""

from __future__ import annotations

from pyspark.sql import DataFrame, SparkSession

DEFAULT_MIN_PITCHES = 10

DIM_PITCHERS = """
-- One row per pitcher: latest name and hand, first and last appearance, workload.
with appearances as (
    select
        pitcher_id, pitcher_name, pitcher_hand, pitching_team, game_date,
        row_number() over (
            partition by pitcher_id order by game_date desc, game_pk desc, at_bat_number desc
        ) as recency
    from fct_pitches
)
select
    pitcher_id,
    max(case when recency = 1 then pitcher_name end) as pitcher_name,
    max(case when recency = 1 then pitcher_hand end) as pitcher_hand,
    max(case when recency = 1 then pitching_team end) as latest_team,
    min(game_date) as first_game_date,
    max(game_date) as last_game_date,
    count(distinct game_date) as games,
    count(*) as pitches
from appearances
group by pitcher_id
"""

PITCHER_ARSENAL = """
-- What each pitcher throws in a season, how hard, how it moves, and how well it works.
-- Grain: season x pitcher x pitch type.
with by_type as (
    select
        season, pitcher_id, pitch_type,
        max(pitch_name) as pitch_name,
        count(*) as pitches,
        sum(count(*)) over (partition by season, pitcher_id) as pitcher_total_pitches,
        avg(velo_mph) as avg_velo_mph,
        max(velo_mph) as max_velo_mph,
        avg(spin_rpm) as avg_spin_rpm,
        avg(induced_vert_break_in) as avg_ivb_in,
        avg(arm_side_break_in) as avg_arm_side_break_in,
        avg(extension_ft) as avg_extension_ft,
        count(*) filter (where is_swing) as swings,
        count(*) filter (where is_whiff) as whiffs,
        count(*) filter (where is_csw) as csw,
        count(*) filter (where is_in_zone) as in_zone,
        count(*) filter (where not is_in_zone) as out_of_zone,
        count(*) filter (where is_chase) as chases,
        avg(xwoba) filter (where is_in_play) as xwoba_on_contact,
        sum(pitcher_run_value) as run_value
    from fct_pitches
    group by season, pitcher_id, pitch_type
)
select
    t.season, t.pitcher_id, p.pitcher_name, p.pitcher_hand, t.pitch_type, t.pitch_name, t.pitches,
    round(t.pitches / t.pitcher_total_pitches, 4) as usage_pct,
    round(t.avg_velo_mph, 1) as avg_velo_mph,
    round(t.max_velo_mph, 1) as max_velo_mph,
    round(t.avg_spin_rpm, 0) as avg_spin_rpm,
    round(t.avg_ivb_in, 1) as avg_ivb_in,
    round(t.avg_arm_side_break_in, 1) as avg_arm_side_break_in,
    round(t.avg_extension_ft, 2) as avg_extension_ft,
    round(t.whiffs / nullif(t.swings, 0), 3) as whiff_pct,
    round(t.csw / t.pitches, 3) as csw_pct,
    round(t.in_zone / t.pitches, 3) as zone_pct,
    round(t.chases / nullif(t.out_of_zone, 0), 3) as chase_pct,
    round(t.xwoba_on_contact, 3) as xwoba_on_contact,
    round(t.run_value / t.pitches * 100, 2) as run_value_per_100
from by_type t
join dim_pitchers p using (pitcher_id)
where t.pitches >= {min_pitches}
"""

PITCH_MOVEMENT = """
-- How each pitch's shape compares with the league average for the same pitch type,
-- hand and season. Grain: season x pitcher x pitch type.
with pitcher_shape as (
    select
        season, pitcher_id, pitcher_hand, pitch_type,
        count(*) as pitches,
        avg(velo_mph) as velo_mph,
        avg(induced_vert_break_in) as ivb_in,
        avg(arm_side_break_in) as arm_side_break_in,
        avg(spin_rpm) as spin_rpm
    from fct_pitches
    group by season, pitcher_id, pitcher_hand, pitch_type
    having count(*) >= {min_pitches}
),
league_shape as (
    -- Pitch-weighted league baseline and spread for each pitch type / hand / season.
    select
        season, pitcher_hand, pitch_type,
        avg(velo_mph) as lg_velo_mph,
        avg(induced_vert_break_in) as lg_ivb_in,
        stddev_samp(induced_vert_break_in) as lg_ivb_sd,
        avg(arm_side_break_in) as lg_arm_side_break_in,
        stddev_samp(arm_side_break_in) as lg_arm_side_break_sd
    from fct_pitches
    group by season, pitcher_hand, pitch_type
)
select
    s.season, s.pitcher_id, d.pitcher_name, s.pitcher_hand, s.pitch_type, s.pitches,
    round(s.velo_mph, 1) as velo_mph,
    round(s.ivb_in, 1) as ivb_in,
    round(s.arm_side_break_in, 1) as arm_side_break_in,
    round(s.spin_rpm, 0) as spin_rpm,
    round(s.velo_mph - l.lg_velo_mph, 1) as velo_vs_league_mph,
    round(s.ivb_in - l.lg_ivb_in, 1) as ivb_vs_league_in,
    round(s.arm_side_break_in - l.lg_arm_side_break_in, 1) as arm_side_vs_league_in,
    round((s.ivb_in - l.lg_ivb_in) / nullif(l.lg_ivb_sd, 0), 2) as ivb_z,
    round((s.arm_side_break_in - l.lg_arm_side_break_in) / nullif(l.lg_arm_side_break_sd, 0), 2) as arm_side_z
from pitcher_shape s
join league_shape l using (season, pitcher_hand, pitch_type)
join dim_pitchers d using (pitcher_id)
"""

PITCHER_GAME_TRENDS = """
-- Game-by-game fastball velocity and release height against the pitcher's own
-- prior games this season. A sustained drop is an early flag for a performance staff.
-- Grain: pitcher x game.
with per_game as (
    select
        season, pitcher_id, game_pk, game_date,
        count(*) as fastballs,
        avg(velo_mph) as fb_velo_mph,
        max(velo_mph) as fb_max_velo_mph,
        avg(release_z_ft) as release_z_ft,
        avg(extension_ft) as extension_ft
    from fct_pitches
    where pitch_type in ('FF', 'SI', 'FC')
    group by season, pitcher_id, game_pk, game_date
),
with_baseline as (
    select
        *,
        -- Baseline = average of all previous games this season, so a game never compares against itself.
        avg(fb_velo_mph) over (
            partition by season, pitcher_id order by game_date, game_pk
            rows between unbounded preceding and 1 preceding
        ) as baseline_velo_mph,
        avg(release_z_ft) over (
            partition by season, pitcher_id order by game_date, game_pk
            rows between unbounded preceding and 1 preceding
        ) as baseline_release_z_ft,
        count(*) over (
            partition by season, pitcher_id order by game_date, game_pk
            rows between unbounded preceding and 1 preceding
        ) as prior_games
    from per_game
)
select
    b.season, b.pitcher_id, d.pitcher_name, b.game_pk, b.game_date, b.fastballs,
    round(b.fb_velo_mph, 1) as fb_velo_mph,
    round(b.fb_max_velo_mph, 1) as fb_max_velo_mph,
    round(b.release_z_ft, 2) as release_z_ft,
    round(b.extension_ft, 2) as extension_ft,
    b.prior_games,
    round(b.fb_velo_mph - b.baseline_velo_mph, 1) as velo_vs_baseline_mph,
    round((b.release_z_ft - b.baseline_release_z_ft) * 12, 1) as release_z_vs_baseline_in,
    coalesce(b.prior_games >= 3 and b.fb_velo_mph - b.baseline_velo_mph <= -1.5, false) as velo_drop_flag
from with_baseline b
join dim_pitchers d using (pitcher_id)
"""

RELEASE_CONSISTENCY = """
-- How repeatable each pitcher's release point is, and how well pitch types "tunnel"
-- (leave the hand from the same spot). Grain: season x pitcher.
with pitches as (
    select * from fct_pitches
    where release_x_ft is not null and release_z_ft is not null
),
overall as (
    select
        season, pitcher_id,
        count(*) as pitches,
        avg(release_x_ft) as release_x_ft,
        avg(release_z_ft) as release_z_ft,
        stddev_samp(release_x_ft) as release_x_sd_ft,
        stddev_samp(release_z_ft) as release_z_sd_ft,
        stddev_samp(extension_ft) as extension_sd_ft,
        stddev_samp(arm_angle_deg) as arm_angle_sd_deg
    from pitches
    group by season, pitcher_id
),
type_centroids as (
    select
        season, pitcher_id, pitch_type,
        count(*) as pitches,
        avg(release_x_ft) as cx,
        avg(release_z_ft) as cz
    from pitches
    group by season, pitcher_id, pitch_type
    having count(*) >= {min_pitches}
),
primary_pitch as (
    select season, pitcher_id, pitch_type, cx, cz
    from (
        select *, row_number() over (
            partition by season, pitcher_id order by pitches desc, pitch_type
        ) as rn
        from type_centroids
    )
    where rn = 1
),
tunnel as (
    -- Distance from each secondary pitch's release centroid to the primary pitch's.
    select
        t.season, t.pitcher_id,
        max(sqrt(power(t.cx - p.cx, 2) + power(t.cz - p.cz, 2))) as max_gap_ft,
        avg(sqrt(power(t.cx - p.cx, 2) + power(t.cz - p.cz, 2))) as avg_gap_ft
    from type_centroids t
    join primary_pitch p on t.season = p.season and t.pitcher_id = p.pitcher_id
    where t.pitch_type <> p.pitch_type
    group by t.season, t.pitcher_id
)
select
    o.season, o.pitcher_id, d.pitcher_name, d.pitcher_hand, o.pitches,
    pp.pitch_type as primary_pitch_type,
    round(o.release_x_ft, 2) as release_x_ft,
    round(o.release_z_ft, 2) as release_z_ft,
    round(o.release_x_sd_ft * 12, 2) as release_x_sd_in,
    round(o.release_z_sd_ft * 12, 2) as release_z_sd_in,
    -- One number for "how big is the release cloud": radius of the 1-sd ellipse, in inches.
    round(sqrt(power(o.release_x_sd_ft, 2) + power(o.release_z_sd_ft, 2)) * 12, 2) as release_spread_in,
    round(o.extension_sd_ft * 12, 2) as extension_sd_in,
    round(o.arm_angle_sd_deg, 2) as arm_angle_sd_deg,
    round(t.max_gap_ft * 12, 2) as max_tunnel_gap_in,
    round(t.avg_gap_ft * 12, 2) as avg_tunnel_gap_in,
    percent_rank() over (
        partition by o.season
        order by sqrt(power(o.release_x_sd_ft, 2) + power(o.release_z_sd_ft, 2)) desc
    ) as consistency_pctile
from overall o
join dim_pitchers d using (pitcher_id)
left join primary_pitch pp on o.season = pp.season and o.pitcher_id = pp.pitcher_id
left join tunnel t on o.season = t.season and o.pitcher_id = t.pitcher_id
where o.pitches >= {min_pitches}
"""

# Built in this order; dim_pitchers first because every mart joins it.
MARTS: dict[str, str] = {
    "dim_pitchers": DIM_PITCHERS,
    "mart_pitcher_arsenal": PITCHER_ARSENAL,
    "mart_pitch_movement": PITCH_MOVEMENT,
    "mart_pitcher_game_trends": PITCHER_GAME_TRENDS,
    "mart_release_consistency": RELEASE_CONSISTENCY,
}


def build_gold(
    spark: SparkSession, silver: DataFrame, min_pitches: int = DEFAULT_MIN_PITCHES
) -> dict[str, DataFrame]:
    """Return every gold table as a DataFrame, keyed by table name.

    Uses temp views, so it runs the same on Databricks and on a local SparkSession.
    """
    silver.createOrReplaceTempView("fct_pitches")
    out: dict[str, DataFrame] = {}
    for name, sql in MARTS.items():
        df = spark.sql(sql.format(min_pitches=int(min_pitches)))
        if name == "dim_pitchers":
            # No .cache(): serverless compute doesn't support it, and the dimension is cheap.
            df.createOrReplaceTempView("dim_pitchers")
        out[name] = df
    return out
