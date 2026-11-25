# Databricks notebook source
# MAGIC %md
# MAGIC # 04 · Quality checks
# MAGIC
# MAGIC The same checks stat-cast runs as dbt tests: unique keys, valid pitcher hand, usage shares that add up,
# MAGIC plausible velocities, and every tracked game date in bronze reaching silver. Any failure fails the job.

# COMMAND ----------

# MAGIC %run ./_common

# COMMAND ----------

from statcast_lakehouse.checks import run_checks
from statcast_lakehouse.gold import MARTS

tables = {
    "bronze_pitches": spark.table(names.bronze_pitches),
    "fct_pitches": spark.table(names.silver_pitches),
    **{name: spark.table(names.gold(name)) for name in MARTS},
}
failures = run_checks(spark, tables)

if failures:
    raise AssertionError("\n".join(failures))
print("All quality checks passed.")
