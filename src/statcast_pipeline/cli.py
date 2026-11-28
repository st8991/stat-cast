"""Command line entry point: run the extract + load steps without Airflow.

    python -m statcast_pipeline init-db
    python -m statcast_pipeline run --date 2025-06-01
    python -m statcast_pipeline backfill --start 2025-06-01 --end 2025-06-07 --source sample
    python -m statcast_pipeline --game-types postseason backfill --start 2025-10-01 --end 2025-11-02
"""

from __future__ import annotations

import argparse
import logging
from dataclasses import replace
from datetime import date, timedelta

import psycopg

from .config import get_settings
from .extract import extract_day
from .load import ensure_schema, load_landed_file
from .season import parse_game_types


def run_day(game_date: date, settings) -> int:
    path, rows = extract_day(game_date, settings)
    if path is None:
        return 0
    with psycopg.connect(settings.dsn) as conn:
        return load_landed_file(conn, path, source=settings.source)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="statcast_pipeline")
    parser.add_argument("--source", choices=["savant", "sample"], help="override STATCAST_SOURCE")
    parser.add_argument(
        "--game-types", help='override STATCAST_GAME_TYPES, e.g. "regular,postseason" (also: spring)'
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db", help="create the raw schema and tables")
    run = sub.add_parser("run", help="extract and load one game date")
    run.add_argument("--date", type=date.fromisoformat, required=True)
    bf = sub.add_parser("backfill", help="extract and load an inclusive date range")
    bf.add_argument("--start", type=date.fromisoformat, required=True)
    bf.add_argument("--end", type=date.fromisoformat, required=True)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    if args.source:
        settings = replace(settings, source=args.source)
    if args.game_types:
        parse_game_types(args.game_types)  # fail fast on a typo
        settings = replace(settings, game_types=args.game_types)

    if args.cmd == "init-db":
        with psycopg.connect(settings.dsn) as conn:
            ensure_schema(conn)
        print("raw schema ready")
    elif args.cmd == "run":
        print(f"{args.date}: {run_day(args.date, settings)} rows")
    elif args.cmd == "backfill":
        total, d = 0, args.start
        while d <= args.end:
            total += run_day(d, settings)
            d += timedelta(days=1)
        print(f"{args.start}..{args.end}: {total} rows")


if __name__ == "__main__":
    main()
