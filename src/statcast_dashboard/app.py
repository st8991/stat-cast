"""stat-cast dashboard: one screen over the warehouse and the pipeline that feeds it.

    uvicorn statcast_dashboard.app:app --port 8050

Reads the same WAREHOUSE_* settings as the loader. Set AIRFLOW_DB_DSN to show the
latest DAG runs (read straight from Airflow's metadata database, read-only).

The JSON routes end in `.json` on purpose: `python -m statcast_dashboard.export`
writes the exact same paths to disk, so the static snapshot and the live app
serve one frontend unchanged.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from statcast_pipeline.config import get_settings

from . import queries

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="stat-cast dashboard", docs_url="/api/docs", openapi_url="/api/openapi.json")


@contextmanager
def warehouse():
    try:
        conn = psycopg.connect(get_settings().dsn, connect_timeout=5)
    except psycopg.OperationalError as exc:
        raise HTTPException(503, f"warehouse unreachable: {str(exc).splitlines()[0]}") from exc
    try:
        yield conn
    except psycopg.errors.UndefinedTable as exc:
        raise HTTPException(503, "marts not built yet: run the DAG (or `make backfill`) first") from exc
    finally:
        conn.close()


@app.get("/api/overview.json")
def overview(season: int | None = None) -> dict:
    with warehouse() as conn:
        return queries.overview(conn, season)


@app.get("/api/pitcher/{pitcher_id}.json")
def pitcher(pitcher_id: int, season: int | None = None) -> dict:
    with warehouse() as conn:
        found = queries.pitcher(conn, pitcher_id, season)
    if found is None:
        raise HTTPException(404, f"no pitcher {pitcher_id}")
    return found


@app.get("/api/health.json")
def health() -> dict:
    with warehouse() as conn:
        result = queries.warehouse_health(conn)
    result["airflow"] = queries.airflow_runs(os.getenv("AIRFLOW_DB_DSN"))
    result["mode"] = "live"
    return result


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
