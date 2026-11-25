# Databricks notebook source
# MAGIC %md
# MAGIC # 02 · Silver: one clean row per pitch
# MAGIC
# MAGIC Types the raw strings, drops rows with no key or no tracking, keeps the newest version of a re-issued
# MAGIC pitch, adds movement in inches and swing/whiff/chase flags, then `MERGE`s into `pitches` on `pitch_id`.
# MAGIC Re-landing a corrected day updates its pitches instead of duplicating them.
# MAGIC
# MAGIC Incremental by default: only bronze rows ingested after the newest row already in silver.
# MAGIC Set `full_refresh = true` to rebuild from all of bronze.

# COMMAND ----------

# MAGIC %run ./_common

# COMMAND ----------

from pyspark.sql import functions as F

from statcast_lakehouse.schema import INGESTED_AT
from statcast_lakehouse.silver import to_silver

silver_exists = spark.catalog.tableExists(names.silver_pitches)
bronze = spark.table(names.bronze_pitches)

if silver_exists and not FULL_REFRESH:
    watermark = spark.table(names.silver_pitches).agg(F.max(INGESTED_AT)).first()[0]
    if watermark is not None:
        bronze = bronze.where(F.col(INGESTED_AT) > F.lit(watermark))
        print(f"incremental: bronze rows ingested after {watermark}")

staged = to_silver(bronze)
staged.createOrReplaceTempView("staged_pitches")
print(f"{staged.count()} pitches to merge")

# COMMAND ----------

if not silver_exists or FULL_REFRESH:
    spark.sql(
        f"""
        CREATE OR REPLACE TABLE {names.silver_pitches}
        CLUSTER BY (game_date, pitcher_id)
        COMMENT 'One row per tracked pitch. Built from statcast_bronze.pitches_raw.'
        AS SELECT * FROM staged_pitches
        """
    )
else:
    spark.sql(
        f"""
        MERGE INTO {names.silver_pitches} t
        USING staged_pitches s
        ON t.pitch_id = s.pitch_id
        WHEN MATCHED AND s.{INGESTED_AT} >= t.{INGESTED_AT} THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
    )

# COMMAND ----------

display(
    spark.table(names.silver_pitches)
    .groupBy("game_date")
    .agg(F.count("*").alias("pitches"), F.countDistinct("pitcher_id").alias("pitchers"))
    .orderBy("game_date")
)
