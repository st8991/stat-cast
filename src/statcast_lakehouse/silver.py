"""Silver: one clean, typed row per pitch.

Ports two pieces of stat-cast:
- `conform` is transform.py: typed contract, unparseable values become NULL,
  rows without a full key are dropped, repeated pitches keep the latest version.
- `stage` is dbt's stg_statcast__pitches: readable names, movement in inches,
  arm-side break, and swing/whiff/chase flags.
"""

from __future__ import annotations

from pyspark.sql import Column, DataFrame, Window
from pyspark.sql import functions as F

from .schema import CONTRACT, INGESTED_AT, PRIMARY_KEY, SOURCE_FILE

SWING_DESCRIPTIONS = [
    "swinging_strike",
    "swinging_strike_blocked",
    "foul_tip",
    "foul",
    "foul_bunt",
    "missed_bunt",
    "bunt_foul_tip",
    "hit_into_play",
]
WHIFF_DESCRIPTIONS = ["swinging_strike", "swinging_strike_blocked", "foul_tip", "missed_bunt"]


def _typed(col_name: str, spark_type: str) -> Column:
    c = F.col(f"`{col_name}`").cast("string")
    if spark_type == "string":
        trimmed = F.trim(c)
        return F.when(trimmed == "", F.lit(None).cast("string")).otherwise(trimmed)
    if spark_type == "int":
        # "6.0" is a valid integer in a CSV written by pandas; go through double first.
        return F.expr(f"try_cast(try_cast(`{col_name}` as double) as int)")
    return F.expr(f"try_cast(`{col_name}` as {spark_type})")


def conform(bronze: DataFrame) -> DataFrame:
    """Select, type and de-duplicate bronze rows to the silver contract."""
    cols = [
        (_typed(name, t) if name in bronze.columns else F.lit(None).cast(t)).alias(name)
        for name, t in CONTRACT.items()
    ]
    ingested = F.col(INGESTED_AT) if INGESTED_AT in bronze.columns else F.current_timestamp()
    source_file = F.col(SOURCE_FILE) if SOURCE_FILE in bronze.columns else F.lit(None).cast("string")
    typed = bronze.select(*cols, ingested.alias(INGESTED_AT), source_file.alias(SOURCE_FILE))

    keyed = typed.dropna(subset=[*PRIMARY_KEY, "game_date"])

    # Savant re-issues corrected rows (pitch types, run values). Keep the newest.
    latest = Window.partitionBy(*PRIMARY_KEY).orderBy(
        F.col(INGESTED_AT).desc(), F.col(SOURCE_FILE).desc_nulls_last()
    )
    return keyed.withColumn("_rn", F.row_number().over(latest)).where("_rn = 1").drop("_rn")


def stage(conformed: DataFrame) -> DataFrame:
    """Rename, convert units and flag outcomes. Rows with no pitch_type are untracked and dropped."""
    df = conformed.where(F.col("pitch_type").isNotNull())

    # pfx_x / pfx_z are feet of movement vs a spinless pitch, catcher's view.
    # Arm-side break flips the sign for righties so positive always means arm side.
    arm_side_pfx = F.when(F.col("p_throws") == "R", -F.col("pfx_x")).otherwise(F.col("pfx_x"))

    out = df.select(
        F.concat_ws("-", "game_pk", "at_bat_number", "pitch_number").alias("pitch_id"),
        "game_pk",
        "game_date",
        F.col("game_year").alias("season"),
        "game_type",
        "at_bat_number",
        "pitch_number",
        "inning",
        "inning_topbot",
        F.col("outs_when_up").alias("outs"),
        "balls",
        "strikes",
        F.concat_ws("-", "balls", "strikes").alias("count_state"),
        "home_team",
        "away_team",
        F.when(F.col("inning_topbot") == "Top", F.col("home_team"))
        .otherwise(F.col("away_team"))
        .alias("pitching_team"),
        F.col("pitcher").alias("pitcher_id"),
        F.col("player_name").alias("pitcher_name"),
        F.col("batter").alias("batter_id"),
        F.col("p_throws").alias("pitcher_hand"),
        F.col("stand").alias("batter_side"),
        "pitch_type",
        "pitch_name",
        F.col("release_speed").alias("velo_mph"),
        F.col("effective_speed").alias("perceived_velo_mph"),
        F.col("release_spin_rate").alias("spin_rpm"),
        F.col("spin_axis").alias("spin_axis_deg"),
        F.col("release_extension").alias("extension_ft"),
        F.col("release_pos_x").alias("release_x_ft"),
        F.col("release_pos_z").alias("release_z_ft"),
        F.col("arm_angle").alias("arm_angle_deg"),
        F.round(F.col("pfx_x") * 12, 1).alias("horz_break_in"),
        F.round(F.col("pfx_z") * 12, 1).alias("induced_vert_break_in"),
        F.round(arm_side_pfx * 12, 1).alias("arm_side_break_in"),
        F.col("plate_x").alias("plate_x_ft"),
        F.col("plate_z").alias("plate_z_ft"),
        "zone",
        F.col("zone").between(1, 9).alias("is_in_zone"),
        F.col("type").alias("result_type"),
        "description",
        "events",
        F.col("bb_type").alias("batted_ball_type"),
        F.col("launch_speed").alias("exit_velo_mph"),
        F.col("launch_angle").alias("launch_angle_deg"),
        F.col("estimated_woba_using_speedangle").alias("xwoba"),
        "woba_value",
        # delta_run_exp is from the batting side; flip it so positive = good for the pitcher.
        (-F.col("delta_run_exp")).alias("pitcher_run_value"),
        F.col("description").isin(SWING_DESCRIPTIONS).alias("is_swing"),
        F.col("description").isin(WHIFF_DESCRIPTIONS).alias("is_whiff"),
        (F.col("description") == "called_strike").alias("is_called_strike"),
        (F.col("description") == "hit_into_play").alias("is_in_play"),
        INGESTED_AT,
        SOURCE_FILE,
    )
    return out.withColumn("is_csw", F.col("is_called_strike") | F.col("is_whiff")).withColumn(
        "is_chase", F.col("is_swing") & ~F.col("is_in_zone")
    )


def to_silver(bronze: DataFrame) -> DataFrame:
    return stage(conform(bronze))
