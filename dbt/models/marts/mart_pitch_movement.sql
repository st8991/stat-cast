-- How each pitch's shape compares with the league average for the same pitch type,
-- hand and season. "Above average" vertical break on a four-seamer is the classic
-- "rising fastball"; extra arm-side run on a sinker is what gets ground balls.
-- Grain: season x pitcher x pitch type.

with pitches as (

    select * from {{ ref('fct_pitches') }}

),

pitcher_shape as (

    select
        season,
        pitcher_id,
        pitcher_hand,
        pitch_type,
        count(*) as pitches,
        avg(velo_mph) as velo_mph,
        avg(induced_vert_break_in) as ivb_in,
        avg(arm_side_break_in) as arm_side_break_in,
        avg(spin_rpm) as spin_rpm
    from pitches
    group by season, pitcher_id, pitcher_hand, pitch_type
    having count(*) >= {{ var('min_pitches') }}

),

league_shape as (

    -- Pitch-weighted league baseline and spread for each pitch type / hand / season.
    select
        season,
        pitcher_hand,
        pitch_type,
        avg(velo_mph) as lg_velo_mph,
        avg(induced_vert_break_in) as lg_ivb_in,
        stddev_samp(induced_vert_break_in) as lg_ivb_sd,
        avg(arm_side_break_in) as lg_arm_side_break_in,
        stddev_samp(arm_side_break_in) as lg_arm_side_break_sd
    from pitches
    group by season, pitcher_hand, pitch_type

)

select
    s.season,
    s.pitcher_id,
    d.pitcher_name,
    s.pitcher_hand,
    s.pitch_type,
    s.pitches,
    round(s.velo_mph::numeric, 1) as velo_mph,
    round(s.ivb_in::numeric, 1) as ivb_in,
    round(s.arm_side_break_in::numeric, 1) as arm_side_break_in,
    round(s.spin_rpm::numeric, 0) as spin_rpm,
    round((s.velo_mph - l.lg_velo_mph)::numeric, 1) as velo_vs_league_mph,
    round((s.ivb_in - l.lg_ivb_in)::numeric, 1) as ivb_vs_league_in,
    round((s.arm_side_break_in - l.lg_arm_side_break_in)::numeric, 1) as arm_side_vs_league_in,
    round(((s.ivb_in - l.lg_ivb_in) / nullif(l.lg_ivb_sd, 0))::numeric, 2) as ivb_z,
    round(((s.arm_side_break_in - l.lg_arm_side_break_in) / nullif(l.lg_arm_side_break_sd, 0))::numeric, 2) as arm_side_z
from pitcher_shape s
join league_shape l using (season, pitcher_hand, pitch_type)
join {{ ref('dim_pitchers') }} d using (pitcher_id)
