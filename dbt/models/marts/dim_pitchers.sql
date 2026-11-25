-- One row per pitcher: latest name and hand, first and last appearance, workload.

with appearances as (

    select
        pitcher_id,
        pitcher_name,
        pitcher_hand,
        pitching_team,
        game_date,
        row_number() over (partition by pitcher_id order by game_date desc, game_pk desc, at_bat_number desc) as recency
    from {{ ref('fct_pitches') }}

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
