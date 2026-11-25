{#-
  One clean row per pitch: renamed, unit-converted, with outcome flags.

  Movement: Statcast pfx_x / pfx_z are feet of movement relative to a spinless
  pitch, from the catcher's view. We convert to inches and also express
  horizontal break from the pitcher's arm side, so a righty's and a lefty's
  run compare directly (positive = arm side, negative = glove side).
-#}

with source as (

    select * from {{ source('raw', 'statcast_pitches') }}
    where pitch_type is not null          -- automatic balls, pitchouts with no tracking

),

renamed as (

    select
        {{ pitch_id('game_pk', 'at_bat_number', 'pitch_number') }} as pitch_id,
        game_pk,
        game_date,
        game_year as season,
        game_type,
        at_bat_number,
        pitch_number,
        inning,
        inning_topbot,
        outs_when_up as outs,
        balls,
        strikes,
        balls || '-' || strikes as count_state,
        home_team,
        away_team,
        case when inning_topbot = 'Top' then home_team else away_team end as pitching_team,

        pitcher as pitcher_id,
        player_name as pitcher_name,
        batter as batter_id,
        p_throws as pitcher_hand,
        stand as batter_side,

        pitch_type,
        pitch_name,
        release_speed as velo_mph,
        effective_speed as perceived_velo_mph,
        release_spin_rate as spin_rpm,
        spin_axis as spin_axis_deg,
        release_extension as extension_ft,
        release_pos_x as release_x_ft,
        release_pos_z as release_z_ft,
        arm_angle as arm_angle_deg,

        round((pfx_x * 12)::numeric, 1) as horz_break_in,
        round((pfx_z * 12)::numeric, 1) as induced_vert_break_in,
        round((case when p_throws = 'R' then -pfx_x else pfx_x end * 12)::numeric, 1) as arm_side_break_in,

        plate_x as plate_x_ft,
        plate_z as plate_z_ft,
        zone,
        zone between 1 and 9 as is_in_zone,

        type as result_type,
        description,
        events,
        bb_type as batted_ball_type,
        launch_speed as exit_velo_mph,
        launch_angle as launch_angle_deg,
        estimated_woba_using_speedangle as xwoba,
        woba_value,
        -- Statcast's delta_run_exp is from the batting team's side; flip it so positive = good for the pitcher.
        -delta_run_exp as pitcher_run_value,

        _loaded_at

    from source

),

flagged as (

    select
        *,
        description in (
            'swinging_strike', 'swinging_strike_blocked', 'foul_tip', 'foul', 'foul_bunt',
            'missed_bunt', 'bunt_foul_tip', 'hit_into_play'
        ) as is_swing,
        description in ('swinging_strike', 'swinging_strike_blocked', 'foul_tip', 'missed_bunt') as is_whiff,
        description = 'called_strike' as is_called_strike,
        description = 'hit_into_play' as is_in_play
    from renamed

)

select
    *,
    is_called_strike or is_whiff as is_csw,
    is_swing and not is_in_zone as is_chase
from flagged
