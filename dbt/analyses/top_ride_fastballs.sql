-- Example ad-hoc query: four-seamers with the most ride relative to league.
select pitcher_name, season, velo_mph, ivb_in, ivb_vs_league_in, ivb_z
from {{ ref('mart_pitch_movement') }}
where pitch_type = 'FF'
order by ivb_vs_league_in desc
limit 10
