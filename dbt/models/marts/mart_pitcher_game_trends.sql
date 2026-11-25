-- Game-by-game velocity and release height against the pitcher's own season
-- baseline. A sustained drop in fastball velo or arm slot is an early flag a
-- performance or health staff would want to see the morning after.
-- Grain: pitcher x game.

with fastballs as (

    select *
    from {{ ref('fct_pitches') }}
    where pitch_type in ('FF', 'SI', 'FC')

),

per_game as (

    select
        season,
        pitcher_id,
        game_pk,
        game_date,
        count(*) as fastballs,
        avg(velo_mph) as fb_velo_mph,
        max(velo_mph) as fb_max_velo_mph,
        avg(release_z_ft) as release_z_ft,
        avg(extension_ft) as extension_ft
    from fastballs
    group by season, pitcher_id, game_pk, game_date

),

with_baseline as (

    select
        *,
        -- Baseline = average of all *previous* games this season, so a game never compares against itself.
        avg(fb_velo_mph) over w as baseline_velo_mph,
        avg(release_z_ft) over w as baseline_release_z_ft,
        count(*) over w as prior_games
    from per_game
    window w as (partition by season, pitcher_id order by game_date, game_pk rows between unbounded preceding and 1 preceding)

)

select
    b.season,
    b.pitcher_id,
    d.pitcher_name,
    b.game_pk,
    b.game_date,
    b.fastballs,
    round(b.fb_velo_mph::numeric, 1) as fb_velo_mph,
    round(b.fb_max_velo_mph::numeric, 1) as fb_max_velo_mph,
    round(b.release_z_ft::numeric, 2) as release_z_ft,
    round(b.extension_ft::numeric, 2) as extension_ft,
    b.prior_games,
    round((b.fb_velo_mph - b.baseline_velo_mph)::numeric, 1) as velo_vs_baseline_mph,
    round(((b.release_z_ft - b.baseline_release_z_ft) * 12)::numeric, 1) as release_z_vs_baseline_in,
    coalesce(b.prior_games >= 3 and b.fb_velo_mph - b.baseline_velo_mph <= -1.5, false) as velo_drop_flag
from with_baseline b
join {{ ref('dim_pitchers') }} d using (pitcher_id)
