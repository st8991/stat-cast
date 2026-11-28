"""
### Statcast daily

Every morning, pull the last few days of pitch-level Statcast data from Baseball
Savant (yesterday plus a short trailing window, `STATCAST_REFRESH_DAYS`, because
Savant corrects pitch types and run values after the fact), land the raw CSVs,
load them into `raw.statcast_pitches` in Postgres, then run `dbt build` to
refresh the staging view, the pitch fact table and the pitcher marts (arsenal,
movement vs league, release consistency, game trends), with tests.

* **Idempotent:** a run replaces its game dates, so retries and re-runs are safe.
* **Off days:** if Savant returns no pitches, load and dbt are skipped.
* **Off-season:** scheduled runs outside the season window for
  `STATCAST_GAME_TYPES` skip without calling Savant.
* **Backfill:** trigger with `{"game_date": "2025-06-01"}` for one day, or
  `airflow backfill create --dag-id statcast_daily --from-date ... --to-date ...`
  for a range (each run loads only the day before its logical date).
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
    def resolve_dates(**context) -> dict:
        """Pick the game dates this run loads.

        Scheduled runs re-pull the trailing refresh window ending yesterday (Savant revises pitch
        types and run values after the fact) and skip the off-season. A run for an explicit
        `game_date`, a manual trigger or a backfill loads exactly one day, in season or not.
        """
        from statcast_pipeline.config import get_settings
        from statcast_pipeline.season import refresh_dates

        override = context["params"].get("game_date")
        if override:
            return {"dates": [date.fromisoformat(override).isoformat()], "scheduled": False}
        # Manual runs in Airflow 3 may have no logical_date; fall back to when the run was queued.
        dag_run = context["dag_run"]
        run_at = context.get("logical_date") or dag_run.run_after
        target = (pendulum.instance(run_at).in_timezone(LOCAL_TZ) - timedelta(days=1)).date()
        scheduled = str(getattr(dag_run, "run_type", "")).lower().endswith("scheduled")
        days = get_settings().refresh_days if scheduled else 1
        return {"dates": [d.isoformat() for d in refresh_dates(target, days)], "scheduled": scheduled}

    @task.short_circuit
    def in_season(resolved: dict) -> bool:
        from statcast_pipeline.config import get_settings
        from statcast_pipeline.season import any_in_season

        if not resolved["scheduled"]:
            return True
        settings = get_settings()
        dates = [date.fromisoformat(d) for d in resolved["dates"]]
        if settings.source == "sample" or any_in_season(dates, settings.game_types):
            return True
        print(f"{resolved['dates']}: off-season for {settings.game_types}, not calling Savant")
        return False

    @task
    def extract(resolved: dict) -> dict:
        from statcast_pipeline.config import get_settings
        from statcast_pipeline.extract import extract_day

        settings = get_settings()
        paths, rows = [], 0
        for d in resolved["dates"]:
            path, n = extract_day(date.fromisoformat(d), settings)
            if path:
                paths.append(str(path))
                rows += n
        return {"dates": resolved["dates"], "paths": paths, "rows": rows}

    @task.short_circuit
    def has_pitches(extracted: dict) -> bool:
        if not extracted["rows"]:
            print(f"{extracted['dates']}: no games, skipping load and dbt")
        return bool(extracted["rows"])

    @task
    def load(extracted: dict) -> int:
        from pathlib import Path

        import psycopg

        from statcast_pipeline.config import get_settings
        from statcast_pipeline.load import load_landed_files

        settings = get_settings()
        with psycopg.connect(settings.dsn) as conn:
            return load_landed_files(conn, [Path(p) for p in extracted["paths"]], source=settings.source)

    dbt_build = BashOperator(
        task_id="dbt_build",
        bash_command=(
            f"{DBT_BIN} build --project-dir {DBT_PROJECT_DIR} --profiles-dir {DBT_PROJECT_DIR} "
            "--target-path /tmp/dbt-target --log-path /tmp/dbt-logs"
        ),
        append_env=True,
        retries=1,
    )

    resolved = resolve_dates()
    extracted = extract(resolved)
    in_season(resolved) >> extracted
    has_pitches(extracted) >> load(extracted) >> dbt_build


statcast_daily()
