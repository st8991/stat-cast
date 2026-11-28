"""Dashboard API: pure helpers always; the routes against built marts when a warehouse has them.

CI runs this file a second time after the sample backfill and `dbt build`, so the
route tests run there against real marts.
"""

from __future__ import annotations

import json

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from statcast_dashboard import queries  # noqa: E402
from statcast_dashboard.app import app  # noqa: E402


def test_default_game_date_mirrors_the_dag():
    # 9:00 AM Central on June 3 loads June 2, like resolve_game_date.
    assert queries._default_game_date("2025-06-03T14:00:00+00:00") == "2025-06-02"
    # 1:00 AM UTC on June 3 is still June 2 in Chicago, so the game date is June 1.
    assert queries._default_game_date("2025-06-03T01:00:00+00:00") == "2025-06-01"
    assert queries._default_game_date(None) is None


def test_airflow_runs_degrades_without_metadata_db():
    assert queries.airflow_runs(None) == {"available": False, "reason": "AIRFLOW_DB_DSN is not set"}
    down = queries.airflow_runs("host=127.0.0.1 port=1 dbname=airflow user=x connect_timeout=1")
    assert down["available"] is False and down["reason"]


def test_frontend_is_served():
    client = TestClient(app)
    page = client.get("/")
    assert page.status_code == 200 and "stat" in page.text
    for asset in ("app.js", "styles.css"):
        assert client.get(f"/{asset}").status_code == 200


@pytest.fixture(scope="module")
def marts_client():
    psycopg = pytest.importorskip("psycopg")
    from statcast_pipeline.config import get_settings

    try:
        with psycopg.connect(get_settings().dsn, connect_timeout=3) as conn, conn.cursor() as cur:
            cur.execute("select to_regclass('marts.mart_pitcher_game_trends'), to_regclass('raw.ingestion_log')")
            if None in cur.fetchone():
                pytest.skip("marts not built; run the sample backfill and dbt build first")
    except psycopg.OperationalError:
        pytest.skip("no Postgres warehouse reachable; set WAREHOUSE_* to run")
    return TestClient(app)


def test_overview_and_pitcher_routes(marts_client):
    ov = marts_client.get("/api/overview.json").json()
    assert ov["season"] in ov["seasons"]
    assert ov["totals"]["pitches"] > 0 and ov["pitchers"]
    assert set(ov["leaders"]) == {"velo", "ride", "whiff", "consistency"}

    pid = ov["pitchers"][0]["pitcher_id"]
    p = marts_client.get(f"/api/pitcher/{pid}.json").json()
    assert p["profile"]["pitcher_id"] == pid
    assert p["arsenal"] and p["pitches"]
    assert sum(a["usage_pct"] for a in p["arsenal"]) <= 1.0001
    assert len(p["pitches"]) <= queries.MAX_PITCH_POINTS

    assert marts_client.get("/api/pitcher/1.json").status_code == 404


def test_health_route(marts_client):
    h = marts_client.get("/api/health.json").json()
    counts = {t["table"]: t["rows"] for t in h["table_counts"]}
    assert counts["raw.statcast_pitches"] > 0
    assert counts["marts.fct_pitches"] > 0
    assert h["freshness"]["last_game_date"]
    assert h["recent_loads"] and h["rows_by_date"]
    assert "available" in h["airflow"]


def test_static_export_matches_api_paths(marts_client, tmp_path):
    from statcast_dashboard.export import export

    out = tmp_path / "site"
    n = export(out, airflow_dsn=None)
    ov = json.loads((out / "api" / "overview.json").read_text())
    assert n == len(ov["pitchers"]) > 0
    assert (out / "index.html").exists()
    assert (out / "api" / "pitcher" / f"{ov['pitchers'][0]['pitcher_id']}.json").exists()
    assert json.loads((out / "api" / "health.json").read_text())["mode"] == "snapshot"
