-- What each pitcher throws in a season, how hard, how it moves, and how well it works.
-- Grain: season x pitcher x pitch type.

with pitches as (

    select * from {{ ref('fct_pitches') }}

),

by_type as (

    select
        season,
        pitcher_id,
        pitch_type,
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

    from pitches
    group by season, pitcher_id, pitch_type

)

select
    t.season,
    t.pitcher_id,
    p.pitcher_name,
    p.pitcher_hand,
    t.pitch_type,
    t.pitch_name,
    t.pitches,
    round(t.pitches::numeric / t.pitcher_total_pitches, 4) as usage_pct,
    round(t.avg_velo_mph::numeric, 1) as avg_velo_mph,
    round(t.max_velo_mph::numeric, 1) as max_velo_mph,
    round(t.avg_spin_rpm::numeric, 0) as avg_spin_rpm,
    round(t.avg_ivb_in::numeric, 1) as avg_ivb_in,
    round(t.avg_arm_side_break_in::numeric, 1) as avg_arm_side_break_in,
    round(t.avg_extension_ft::numeric, 2) as avg_extension_ft,
    round(t.whiffs::numeric / nullif(t.swings, 0), 3) as whiff_pct,
    round(t.csw::numeric / t.pitches, 3) as csw_pct,
    round(t.in_zone::numeric / t.pitches, 3) as zone_pct,
    round(t.chases::numeric / nullif(t.out_of_zone, 0), 3) as chase_pct,
    round(t.xwoba_on_contact::numeric, 3) as xwoba_on_contact,
    round((t.run_value / t.pitches * 100)::numeric, 2) as run_value_per_100
from by_type t
join {{ ref('dim_pitchers') }} p using (pitcher_id)
where t.pitches >= {{ var('min_pitches') }}
