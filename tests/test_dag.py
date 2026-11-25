"""DAG integrity checks. Run in the Airflow environment (skipped elsewhere)."""

from pathlib import Path

import pytest

pytest.importorskip("airflow")

DAGS = Path(__file__).resolve().parents[1] / "dags"


@pytest.fixture(scope="module")
def dagbag():
    from airflow.dag_processing.dagbag import DagBag

    return DagBag(dag_folder=str(DAGS))


def test_no_import_errors(dagbag):
    assert dagbag.import_errors == {}


def test_statcast_daily_shape(dagbag):
    dag = dagbag.dags.get("statcast_daily")
    assert dag is not None
    assert set(dag.task_ids) == {"resolve_game_date", "extract", "has_pitches", "load", "dbt_build"}
    assert dag.get_task("load").upstream_task_ids == {"extract", "has_pitches"}
    assert dag.get_task("dbt_build").upstream_task_ids == {"load"}
    assert dag.catchup is False and dag.max_active_runs == 3


def test_every_task_retries(dagbag):
    dag = dagbag.dags.get("statcast_daily")
    assert all(t.retries >= 1 for t in dag.tasks)
