"""Runs against a real Postgres (skipped when none is reachable)."""

import pandas as pd

from statcast_pipeline import load
from statcast_pipeline.transform import conform


def _use_schema(monkeypatch, schema):
    monkeypatch.setattr(load, "RAW_SCHEMA", schema)
    monkeypatch.setattr(load, "RAW_TABLE", f"{schema}.statcast_pitches")
    monkeypatch.setattr(load, "LOG_TABLE", f"{schema}.ingestion_log")


def _count(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchone()[0]


def test_reloading_a_day_replaces_it(pg_conn, monkeypatch, sample_file):
    conn, schema = pg_conn
    _use_schema(monkeypatch, schema)
    df = conform(pd.read_csv(sample_file))
    day = df[df["game_date"].astype(str) == "2025-06-02"]

    load.load_frame(conn, day, source="test")
    load.load_frame(conn, day, source="test")

    assert _count(conn, f"select count(*) from {schema}.statcast_pitches") == len(day)
    assert _count(conn, f"select count(*) from {schema}.ingestion_log") == 2


def test_loading_one_day_leaves_other_days_alone(pg_conn, monkeypatch, sample_file):
    conn, schema = pg_conn
    _use_schema(monkeypatch, schema)
    df = conform(pd.read_csv(sample_file))
    load.load_frame(conn, df, source="test")
    corrected = df[df["game_date"].astype(str) == "2025-06-03"].head(5)

    load.load_frame(conn, corrected, source="test")

    assert _count(conn, f"select count(*) from {schema}.statcast_pitches where game_date = '2025-06-03'") == 5
    assert _count(conn, f"select count(*) from {schema}.statcast_pitches") == len(df) - (
        (df["game_date"].astype(str) == "2025-06-03").sum() - 5
    )


def test_a_refresh_window_replaces_every_day_in_it(pg_conn, monkeypatch, sample_file, tmp_path):
    conn, schema = pg_conn
    _use_schema(monkeypatch, schema)
    raw = pd.read_csv(sample_file)
    load.load_frame(conn, conform(raw), source="test")

    # Savant "revises" two days: a re-pull returns fewer pitches for each.
    paths = []
    for d in ("2025-06-02", "2025-06-03"):
        path = tmp_path / f"{d}.csv.gz"
        raw[raw["game_date"] == d].head(7).to_csv(path, index=False)
        paths.append(path)
    assert load.load_landed_files(conn, paths, source="test") == 14

    for d in ("2025-06-02", "2025-06-03"):
        assert _count(conn, f"select count(*) from {schema}.statcast_pitches where game_date = '{d}'") == 7
    assert _count(conn, f"select count(*) from {schema}.statcast_pitches where game_date = '2025-06-04'") == (
        raw["game_date"] == "2025-06-04"
    ).sum()
