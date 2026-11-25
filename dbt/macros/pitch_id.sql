{#- A readable, sortable surrogate key: <game_pk>-<at_bat>-<pitch>, e.g. 776543-12-3. -#}
{% macro pitch_id(game_pk, at_bat_number, pitch_number) -%}
    ({{ game_pk }}::text || '-' || {{ at_bat_number }}::text || '-' || {{ pitch_number }}::text)
{%- endmacro %}
