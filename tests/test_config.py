"""Warehouse settings: WAREHOUSE_* fields, or a connection URL such as the ones `neon env pull` writes."""

from __future__ import annotations

import subprocess
import sys

from statcast_pipeline.config import PROJECT_ROOT, warehouse_url_fields

NEON_POOLED = "postgresql://web:pw@ep-x-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
NEON_DIRECT = "postgresql://owner:p%40ss@ep-x.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"


def test_no_url_means_no_overrides():
    assert warehouse_url_fields({"WAREHOUSE_HOST": "postgres"}) == {}


def test_direct_url_beats_pooled_and_is_parsed():
    fields = warehouse_url_fields({"DATABASE_URL": NEON_POOLED, "DATABASE_URL_UNPOOLED": NEON_DIRECT})
    assert fields == {
        "WAREHOUSE_HOST": "ep-x.c-9.us-east-2.aws.neon.tech",
        "WAREHOUSE_PORT": "5432",
        "WAREHOUSE_DB": "neondb",
        "WAREHOUSE_USER": "owner",
        "WAREHOUSE_PASSWORD": "p@ss",
        "WAREHOUSE_SSLMODE": "require",
        "WAREHOUSE_CHANNEL_BINDING": "require",
    }
    assert warehouse_url_fields({"WAREHOUSE_URL": "postgres://a:b@h:6543/d", "DATABASE_URL": NEON_POOLED})[
        "WAREHOUSE_HOST"
    ] == "h"


def _run(env: dict[str, str], code: str) -> str:
    out = subprocess.run(
        [sys.executable, "-c", code],
        env={"PATH": "/usr/bin:/bin", "PYTHONPATH": str(PROJECT_ROOT / "src"), **env},
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def test_settings_and_dbt_exports_follow_the_url():
    code = "from statcast_pipeline.config import get_settings as g; s = g(); print(s.dsn); print(s.shell_exports())"
    out = _run({"DATABASE_URL_UNPOOLED": NEON_DIRECT, "WAREHOUSE_HOST": "postgres"}, code).splitlines()
    assert out[0] == (
        "host=ep-x.c-9.us-east-2.aws.neon.tech port=5432 dbname=neondb user=owner password=p@ss "
        "sslmode=require channel_binding=require"
    )
    assert "export WAREHOUSE_HOST=ep-x.c-9.us-east-2.aws.neon.tech" in out
    assert "export WAREHOUSE_PASSWORD=p@ss" in out
    assert "export WAREHOUSE_SSLMODE=require" in out


def test_fields_still_work_without_a_url():
    out = _run({"WAREHOUSE_HOST": "postgres"}, "from statcast_pipeline.config import get_settings as g; print(g().dsn)")
    assert out == "host=postgres port=5432 dbname=statcast user=statcast password=statcast sslmode=prefer"
