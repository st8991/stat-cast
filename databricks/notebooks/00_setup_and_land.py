# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Setup and land files
# MAGIC
# MAGIC Creates the bronze, silver and gold schemas and the `landing` volume, then lands one raw
# MAGIC CSV per game date in the volume:
# MAGIC
# MAGIC - `source = sample` (default): splits the synthetic sample week in `data/sample/` into daily files,
# MAGIC   so the whole pipeline runs with no network access.
# MAGIC - `source = savant`: pulls each day from `start_date` to `end_date` from Baseball Savant
# MAGIC   (defaults to yesterday) with the same client the Airflow pipeline uses (`statcast_pipeline.extract`).
# MAGIC   Needs outbound internet from your compute.
# MAGIC
# MAGIC A day that's already landed is skipped, so re-running is safe.

# COMMAND ----------

# MAGIC %run ./_common

# COMMAND ----------

for schema in (names.bronze_schema, names.silver_schema, names.gold_schema):
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {schema}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {names.volume}")
os.makedirs(names.landing_dir, exist_ok=True)
print("landing dir:", names.landing_dir)

# COMMAND ----------

import gzip
from datetime import date, timedelta

import pandas as pd

from statcast_lakehouse.config import landing_file_name


def write_landed(game_date: str, csv_text: str) -> str:
    """Write one day's raw CSV to the volume. Write to a temp name first so a half-written file never looks landed."""
    path = os.path.join(names.landing_dir, landing_file_name(game_date))
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8", newline="") as fh:
        fh.write(csv_text)
    os.replace(tmp, path)
    return path


def already_landed(game_date: str) -> bool:
    return os.path.exists(os.path.join(names.landing_dir, landing_file_name(game_date)))


landed, skipped = [], []

if SOURCE == "sample":
    sample_path = os.path.join(REPO_ROOT, "data", "sample", "statcast_sample.csv.gz")
    sample = pd.read_csv(sample_path, dtype=str, keep_default_na=False)
    for game_date, day in sample.groupby("game_date"):
        if already_landed(game_date):
            skipped.append(game_date)
            continue
        write_landed(game_date, day.to_csv(index=False))
        landed.append(game_date)

elif SOURCE == "savant":
    from statcast_pipeline.extract import SAVANT_ROW_CAP, TruncatedResultError, fetch_savant_csv, parse_csv

    yesterday = date.today() - timedelta(days=1)
    start = date.fromisoformat(dbutils.widgets.get("start_date") or yesterday.isoformat())
    end = date.fromisoformat(dbutils.widgets.get("end_date") or start.isoformat())
    if end < start:
        raise ValueError(f"end_date {end} is before start_date {start}")
    for i in range((end - start).days + 1):
        d = start + timedelta(days=i)
        if already_landed(d.isoformat()):
            skipped.append(d.isoformat())
            continue
        day = parse_csv(fetch_savant_csv(d))
        if len(day) >= SAVANT_ROW_CAP:
            raise TruncatedResultError(f"{d}: {len(day)} rows hits the Savant cap; split the query")
        if day.empty:
            print(f"{d}: no pitches (off day)")
            continue
        write_landed(d.isoformat(), day.to_csv(index=False))
        landed.append(d.isoformat())
else:
    raise ValueError(f"Unknown source {SOURCE!r}")

print(f"landed {len(landed)} day(s): {landed}")
print(f"skipped {len(skipped)} already-landed day(s): {skipped}")
