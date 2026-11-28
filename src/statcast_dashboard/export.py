"""Write the dashboard as a static site: the frontend plus a JSON snapshot of the API.

    PYTHONPATH=src python -m statcast_dashboard.export --out dist/dashboard

The output has no server-side parts, so it can go on GitHub Pages or any file
host, and it shows exactly what the live app showed at export time.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

import psycopg

from statcast_pipeline.config import get_settings

from . import queries
from .app import STATIC_DIR


def export(out: Path, airflow_dsn: str | None) -> int:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC_DIR, out)
    api = out / "api"
    (api / "pitcher").mkdir(parents=True)

    def write(path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload, separators=(",", ":")))

    with psycopg.connect(get_settings().dsn) as conn:
        ov = queries.overview(conn)
        write(api / "overview.json", ov)
        for p in ov["pitchers"]:
            write(api / "pitcher" / f"{p['pitcher_id']}.json", queries.pitcher(conn, p["pitcher_id"], ov["season"]))
        health = queries.warehouse_health(conn)
    health["airflow"] = queries.airflow_runs(airflow_dsn)
    health["mode"] = "snapshot"
    health["exported_at"] = datetime.now(UTC).isoformat()
    write(api / "health.json", health)
    return len(ov["pitchers"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path("dist/dashboard"))
    args = parser.parse_args()
    n = export(args.out, os.getenv("AIRFLOW_DB_DSN"))
    print(f"wrote {args.out} ({n} pitchers)")


if __name__ == "__main__":
    main()
