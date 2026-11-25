-- Usage is a share of all the pitcher's pitches, so per pitcher-season it can sum to
-- less than 1 (rare pitches are filtered out) but never more.
select season, pitcher_id, sum(usage_pct) as total_usage
from {{ ref('mart_pitcher_arsenal') }}
group by season, pitcher_id
having sum(usage_pct) > 1.001
