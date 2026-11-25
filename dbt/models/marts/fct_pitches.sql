{{
  config(
    materialized='incremental',
    unique_key='pitch_id',
    incremental_strategy='delete+insert',
    indexes=[
      {'columns': ['pitch_id'], 'unique': true},
      {'columns': ['pitcher_id', 'game_date']},
      {'columns': ['game_date']},
    ],
  )
}}

{#-
  The pitch-level fact table everything else builds on.
  Incremental: each run re-processes the last `lookback_days` of game dates, so a
  re-loaded day (Savant corrects pitch types and run values after the fact)
  replaces its old rows instead of piling up.
-#}

select *
from {{ ref('stg_statcast__pitches') }}

{% if is_incremental() %}
where game_date >= (
    select coalesce(max(game_date), '1900-01-01'::date) - {{ var('lookback_days') }}
    from {{ this }}
)
{% endif %}
