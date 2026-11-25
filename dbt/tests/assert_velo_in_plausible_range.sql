-- Tracked pitches outside 40-106 mph are almost always tracking errors. Returns offending rows.
select pitch_id, pitch_type, velo_mph
from {{ ref('fct_pitches') }}
where velo_mph is not null and (velo_mph < 40 or velo_mph > 106)
