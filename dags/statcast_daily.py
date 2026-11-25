"""
### Statcast daily

Every morning, pull yesterday's pitch-level Statcast data from Baseball Savant,
land the raw CSV, load it into `raw.statcast_pitches` in Postgres, then run
`dbt build` to refresh the staging view, the pitch fact table and the pitcher
marts (arsenal, movement vs league, release consistency, game trends), with
tests.

* **Idempotent:** a run replaces its game date, so retries and re-runs are safe.
* **Off days:** if Savant returns no pitches, load and dbt are skipped.
* **Backfill:** trigger with `{"game_date": "2025-06-01"}` for one day, or
  `airflow backfill create --dag-id statcast_daily --from-date ... --to-date ...`
  for a range (each run loads the day before its logical date).
"""

from __future__ import annotations

import os
from datetime import date, timedelta

import pendulum
from airflow.providers.standard.operators.bash import BashOperator
from airflow.sdk import Param, dag, task

LOCAL_TZ = "America/Chicago"
DBT_PROJECT_DIR = os.getenv("DBT_PROJECT_DIR", "/opt/airflow/dbt")
DBT_BIN = os.getenv("DBT_BIN", "dbt")


@dag(
    dag_id="statcast_daily",
    description="Baseball Savant -> Postgres -> dbt pitcher marts",
    # 9:00 AM Central: games are final and Savant's overnight processing is done.
    schedule="0 9 * * *",
    start_date=pendulum.datetime(2025, 3, 27, tz=LOCAL_TZ),
    catchup=False,
    max_active_runs=3,  # backfills: be polite to Savant
    default_args={
        "owner": "data-eng",
        "retries": 3,
        "retry_delay": timedelta(minutes=5),
        "retry_exponential_backoff": True,
    },
    params={
        "game_date": Param(
            None,
            type=["null", "string"],
            format="date",
            description="Game date to load (YYYY-MM-DD). Leave empty for the day before the run.",
        ),
    },
    tags=["statcast", "baseball", "dbt"],
    doc_md=__doc__,
)
def statcast_daily():
    @task
    def resolve_game_date(**context) -> str:
        override = context["params"].get("game_date")
        if override:
            return date.fromisoformat(override).isoformat()
        # Manual runs in Airflow 3 may have no logical_date; fall back to when the run was queued.
        run_at = context.get("logical_date") or context["dag_run"].run_after
        return (pendulum.instance(run_at).in_timezone(LOCAL_TZ) - timedelta(days=1)).date().isoformat()

    @task
    def extract(game_date: str) -> dict:
        from statcast_pipeline.config import get_settings
        from statcast_pipeline.extract import extract_day

        path, rows = extract_day(date.fromisoformat(game_date), get_settings())
        return {"game_date": game_date, "path": str(path) if path else None, "rows": rows}

    @task.short_circuit
    def has_pitches(extracted: dict) -> bool:
        if not extracted["rows"]:
            print(f"{extracted['game_date']}: no games, skipping load and dbt")
        return bool(extracted["rows"])

    @task
    def load(extracted: dict) -> int:
        from pathlib import Path

        import psycopg

        from statcast_pipeline.config import get_settings
        from statcast_pipeline.load import load_landed_file

        settings = get_settings()
        with psycopg.connect(settings.dsn) as conn:
            return load_landed_file(conn, Path(extracted["path"]), source=settings.source)

    dbt_build = BashOperator(
        task_id="dbt_build",
        bash_command=(
            f"{DBT_BIN} build --project-dir {DBT_PROJECT_DIR} --profiles-dir {DBT_PROJECT_DIR} "
            "--target-path /tmp/dbt-target --log-path /tmp/dbt-logs"
        ),
        append_env=True,
        retries=1,
    )

    game_date = resolve_game_date()
    extracted = extract(game_date)
    has_pitches(extracted) >> load(extracted) >> dbt_build


statcast_daily()
