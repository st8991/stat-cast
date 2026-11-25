-- How repeatable each pitcher's release point is, and how well their pitch types
-- "tunnel" (leave the hand from the same spot). A tight release cluster and small
-- gaps between pitch types make pitches harder to tell apart early.
-- Grain: season x pitcher.

with pitches as (

    select * from {{ ref('fct_pitches') }}
    where release_x_ft is not null and release_z_ft is not null

),

overall as (

    select
        season,
        pitcher_id,
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
        season,
        pitcher_id,
        pitch_type,
        count(*) as pitches,
        avg(release_x_ft) as cx,
        avg(release_z_ft) as cz
    from pitches
    group by season, pitcher_id, pitch_type
    having count(*) >= {{ var('min_pitches') }}

),

primary_pitch as (

    select distinct on (season, pitcher_id)
        season, pitcher_id, pitch_type, cx, cz
    from type_centroids
    order by season, pitcher_id, pitches desc, pitch_type

),

tunnel as (

    -- Distance from each secondary pitch's release centroid to the primary pitch's.
    select
        t.season,
        t.pitcher_id,
        max(sqrt(power(t.cx - p.cx, 2) + power(t.cz - p.cz, 2))) as max_gap_ft,
        avg(sqrt(power(t.cx - p.cx, 2) + power(t.cz - p.cz, 2))) as avg_gap_ft
    from type_centroids t
    join primary_pitch p using (season, pitcher_id)
    where t.pitch_type <> p.pitch_type
    group by t.season, t.pitcher_id

)

select
    o.season,
    o.pitcher_id,
    d.pitcher_name,
    d.pitcher_hand,
    o.pitches,
    pp.pitch_type as primary_pitch_type,
    round(o.release_x_ft::numeric, 2) as release_x_ft,
    round(o.release_z_ft::numeric, 2) as release_z_ft,
    round((o.release_x_sd_ft * 12)::numeric, 2) as release_x_sd_in,
    round((o.release_z_sd_ft * 12)::numeric, 2) as release_z_sd_in,
    -- One number for "how big is the release cloud": radius of the 1-sd ellipse, in inches.
    round((sqrt(power(o.release_x_sd_ft, 2) + power(o.release_z_sd_ft, 2)) * 12)::numeric, 2) as release_spread_in,
    round((o.extension_sd_ft * 12)::numeric, 2) as extension_sd_in,
    round(o.arm_angle_sd_deg::numeric, 2) as arm_angle_sd_deg,
    round((t.max_gap_ft * 12)::numeric, 2) as max_tunnel_gap_in,
    round((t.avg_gap_ft * 12)::numeric, 2) as avg_tunnel_gap_in,
    percent_rank() over (partition by o.season order by sqrt(power(o.release_x_sd_ft, 2) + power(o.release_z_sd_ft, 2)) desc)
        as consistency_pctile
from overall o
join {{ ref('dim_pitchers') }} d using (pitcher_id)
left join primary_pitch pp using (season, pitcher_id)
left join tunnel t using (season, pitcher_id)
where o.pitches >= {{ var('min_pitches') }}
