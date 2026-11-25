# Databricks notebook source
# MAGIC %md
# MAGIC # 03 · Gold: pitcher marts
# MAGIC
# MAGIC Rebuilds each mart from silver (they're small, so a full rebuild is simpler than incremental logic):
# MAGIC
# MAGIC | Table | Grain | What it answers |
# MAGIC |---|---|---|
# MAGIC | `dim_pitchers` | pitcher | latest name, hand, team, workload |
# MAGIC | `mart_pitcher_arsenal` | season x pitcher x pitch type | usage, velo, spin, movement, whiff, CSW, run value |
# MAGIC | `mart_pitch_movement` | season x pitcher x pitch type | shape vs league average for that pitch and hand |
# MAGIC | `mart_pitcher_game_trends` | pitcher x game | fastball velo and release height vs prior games, drop flag |
# MAGIC | `mart_release_consistency` | season x pitcher | release point spread and pitch tunneling |

# COMMAND ----------

# MAGIC %run ./_common

# COMMAND ----------

from statcast_lakehouse.gold import build_gold

silver = spark.table(names.silver_pitches)
gold = build_gold(spark, silver, min_pitches=MIN_PITCHES)

for name, df in gold.items():
    target = names.gold(name)
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(target)
    print(f"{target}: {spark.table(target).count()} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC Example: who has the most "rising" four-seamers (induced vertical break above league average)?

# COMMAND ----------

display(
    spark.sql(
        f"""
        SELECT pitcher_name, pitcher_hand, pitches, velo_mph, ivb_in, ivb_vs_league_in, ivb_z
        FROM {names.gold('mart_pitch_movement')}
        WHERE pitch_type = 'FF'
        ORDER BY ivb_vs_league_in DESC
        LIMIT 10
        """
    )
)
