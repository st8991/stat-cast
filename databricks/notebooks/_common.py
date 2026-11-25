# Databricks notebook source
# Shared setup for every pipeline notebook: job parameters (as widgets) and the src/ import path.
# Each notebook runs this with `%run ./_common`.

import os
import sys

# Make src/ importable (statcast_lakehouse, and statcast_pipeline for the Savant client and column contract)
# from the stat-cast Git folder or a deployed bundle. Notebooks live in databricks/notebooks/.
REPO_ROOT = os.path.abspath(os.path.join(os.getcwd(), "..", ".."))
_src = os.path.join(REPO_ROOT, "src")
if _src not in sys.path:
    sys.path.insert(0, _src)

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.dropdown("source", "sample", ["sample", "savant"], "Data source")
dbutils.widgets.text("start_date", "", "Savant start date (YYYY-MM-DD)")
dbutils.widgets.text("end_date", "", "Savant end date (YYYY-MM-DD)")
dbutils.widgets.dropdown("full_refresh", "false", ["false", "true"], "Rebuild silver from all of bronze")
dbutils.widgets.text("min_pitches", "10", "Min pitches for a pitch type to appear in marts")

from statcast_lakehouse.config import Names  # noqa: E402

names = Names(catalog=dbutils.widgets.get("catalog").strip() or "workspace")
SOURCE = dbutils.widgets.get("source")
FULL_REFRESH = dbutils.widgets.get("full_refresh") == "true"
MIN_PITCHES = int(dbutils.widgets.get("min_pitches") or 10)
print(f"catalog={names.catalog} source={SOURCE} full_refresh={FULL_REFRESH} min_pitches={MIN_PITCHES}")
