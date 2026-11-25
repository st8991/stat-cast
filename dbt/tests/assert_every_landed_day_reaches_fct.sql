-- Every game date in the raw table should be present in the fact table after a build.
select r.game_date
from (select distinct game_date from {{ source('raw', 'statcast_pitches') }} where pitch_type is not null) r
left join (select distinct game_date from {{ ref('fct_pitches') }}) f using (game_date)
where f.game_date is null
