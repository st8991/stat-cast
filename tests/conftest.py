import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

SAMPLE = ROOT / "data" / "sample" / "statcast_sample.csv.gz"


@pytest.fixture
def sample_file() -> Path:
    return SAMPLE


@pytest.fixture
def pg_conn():
    """A connection to the warehouse, or skip if none is reachable (CI provides one)."""
    psycopg = pytest.importorskip("psycopg")
    from statcast_pipeline.config import get_settings

    try:
        conn = psycopg.connect(get_settings().dsn, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip("no Postgres warehouse reachable; set WAREHOUSE_* to run")
    # Isolate each test in a throwaway schema so it never touches real data.
    schema = f"test_{os.getpid()}"
    with conn.cursor() as cur:
        cur.execute(f"create schema {schema}")
    yield conn, schema
    with conn.cursor() as cur:
        cur.execute(f"drop schema {schema} cascade")
    conn.commit()
    conn.close()
