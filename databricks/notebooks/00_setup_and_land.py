# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Setup and land files
# MAGIC
# MAGIC Creates the bronze, silver and gold schemas and the `landing` volume, then lands one raw
# MAGIC CSV per game date in the volume:
# MAGIC
# MAGIC - `source = sample` (default): splits the synthetic sample week in `data/sample/` into daily files,
# MAGIC   so the whole pipeline runs with no network access.
# MAGIC - `source = savant`: pulls from Baseball Savant with the same client the Airflow pipeline uses
# MAGIC   (`statcast_pipeline.extract`), for the game types in `game_types`. Needs outbound internet from your compute.
# MAGIC   - With `start_date` / `end_date`: a backfill of that range. Days already landed are skipped.
# MAGIC   - Without them (the daily run): re-pulls the last `refresh_days` days ending yesterday, because Savant
# MAGIC     corrects pitch types and run values after the fact. A day whose data changed lands as a new version
# MAGIC     (`statcast_YYYY-MM-DD__<pull time>.csv.gz`); silver keeps the newest. Outside the season window for
# MAGIC     `game_types` it skips Savant entirely.
# MAGIC
# MAGIC Re-running is safe: an unchanged day is never landed twice.

# COMMAND ----------

# MAGIC %run ./_common

# COMMAND ----------

for schema in (names.bronze_schema, names.silver_schema, names.gold_schema):
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {schema}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {names.volume}")
os.makedirs(names.landing_dir, exist_ok=True)
print("landing dir:", names.landing_dir)

# COMMAND ----------

from datetime import date, timedelta

import pandas as pd

from statcast_lakehouse.landing import landed_versions, write_landed
from statcast_pipeline.season import any_in_season, parse_game_types, refresh_dates

landed, skipped = [], []

if SOURCE == "sample":
    sample_path = os.path.join(REPO_ROOT, "data", "sample", "statcast_sample.csv.gz")
    sample = pd.read_csv(sample_path, dtype=str, keep_default_na=False)
    for game_date, day in sample.groupby("game_date"):
        if landed_versions(names.landing_dir, game_date):
            skipped.append(game_date)
            continue
        write_landed(names.landing_dir, game_date, day.to_csv(index=False))
        landed.append(game_date)

elif SOURCE == "savant":
    from statcast_pipeline.extract import SAVANT_ROW_CAP, TruncatedResultError, fetch_savant_csv, parse_csv

    game_types = ",".join(parse_game_types(dbutils.widgets.get("game_types")))
    start_arg, end_arg = dbutils.widgets.get("start_date").strip(), dbutils.widgets.get("end_date").strip()

    if start_arg or end_arg:
        # Backfill: an explicit range. Days already landed are skipped, to stay polite to Savant.
        start = date.fromisoformat(start_arg or end_arg)
        end = date.fromisoformat(end_arg or start_arg)
        if end < start:
            raise ValueError(f"end_date {end} is before start_date {start}")
        dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        refresh = False
    else:
        # Daily run: re-pull the trailing window so Savant's corrections land; skip the off-season.
        dates = refresh_dates(date.today() - timedelta(days=1), int(dbutils.widgets.get("refresh_days") or 3))
        refresh = True
        if not any_in_season(dates, game_types):
            print(f"{dates[0]}..{dates[-1]}: off-season for {game_types}, not calling Savant")
            dates = []

    for d in dates:
        if not refresh and landed_versions(names.landing_dir, d.isoformat()):
            skipped.append(d.isoformat())
            continue
        day = parse_csv(fetch_savant_csv(d, game_types=game_types))
        if len(day) >= SAVANT_ROW_CAP:
            raise TruncatedResultError(f"{d}: {len(day)} rows hits the Savant cap; split the query")
        if day.empty:
            print(f"{d}: no pitches (off day)")
            continue
        if write_landed(names.landing_dir, d.isoformat(), day.to_csv(index=False)):
            landed.append(d.isoformat())
        else:
            skipped.append(d.isoformat())  # re-pulled, unchanged since the last landing
else:
    raise ValueError(f"Unknown source {SOURCE!r}")

print(f"landed {len(landed)} day(s): {landed}")
print(f"skipped {len(skipped)} already-landed or unchanged day(s): {skipped}")
