select season, pitcher_id, pitch_type, count(*) as n
from {{ ref('mart_pitcher_arsenal') }}
group by season, pitcher_id, pitch_type
having count(*) > 1
