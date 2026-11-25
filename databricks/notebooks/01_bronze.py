# Databricks notebook source
# MAGIC %md
# MAGIC # 01 · Bronze: landing files to `pitches_raw`
# MAGIC
# MAGIC Auto Loader picks up only files it hasn't seen (tracked in its checkpoint), keeps every column as a
# MAGIC string, and records the source file and ingest time. `availableNow` processes what's there and stops,
# MAGIC so this runs as a batch step in the daily job.
# MAGIC
# MAGIC When Savant adds a column, Auto Loader stops the stream once to record the new schema; the job task
# MAGIC retries and the column lands as a new string column. Nothing upstream is lost because every raw file stays
# MAGIC in the volume.

# COMMAND ----------

# MAGIC %run ./_common

# COMMAND ----------

from pyspark.sql import functions as F

from statcast_lakehouse.bronze import to_bronze
from statcast_lakehouse.schema import SOURCE_FILE

raw = (
    spark.readStream.format("cloudFiles")
    .option("cloudFiles.format", "csv")
    .option("cloudFiles.schemaLocation", names.autoloader_schema_dir)
    .option("cloudFiles.inferColumnTypes", "false")
    .option("cloudFiles.schemaEvolutionMode", "addNewColumns")
    .option("pathGlobFilter", "*.csv.gz")
    .option("header", "true")
    .load(names.landing_dir)
    .withColumn(SOURCE_FILE, F.col("_metadata.file_path"))
)

query = (
    to_bronze(raw, source=SOURCE)
    .writeStream.option("checkpointLocation", names.autoloader_checkpoint_dir)
    .option("mergeSchema", "true")
    .trigger(availableNow=True)
    .toTable(names.bronze_pitches)
)
query.awaitTermination()

# COMMAND ----------

display(
    spark.table(names.bronze_pitches)
    .groupBy("game_date", "_source_file")
    .agg(F.count("*").alias("rows"), F.max("_ingested_at").alias("ingested_at"))
    .orderBy("game_date")
)
