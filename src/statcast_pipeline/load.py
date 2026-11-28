"""Load conformed pitches into Postgres, one game date at a time, idempotently.

Each load replaces whole game dates inside one transaction (delete, then COPY),
so re-running a day or backfilling a range never double counts and a failed
load leaves the previous version in place.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

import pandas as pd
import psycopg

from .schema import COLUMNS, METADATA_COLUMNS, PRIMARY_KEY

log = logging.getLogger(__name__)

RAW_SCHEMA = "raw"
RAW_TABLE = f"{RAW_SCHEMA}.statcast_pitches"
LOG_TABLE = f"{RAW_SCHEMA}.ingestion_log"


def ddl() -> str:
    cols = ",\n    ".join(f"{name} {pg_type}" for name, pg_type in {**COLUMNS, **METADATA_COLUMNS}.items())
    return f"""
create schema if not exists {RAW_SCHEMA};

create table if not exists {RAW_TABLE} (
    {cols},
    primary key ({", ".join(PRIMARY_KEY)})
);
create index if not exists statcast_pitches_game_date_idx on {RAW_TABLE} (game_date);
create index if not exists statcast_pitches_pitcher_idx on {RAW_TABLE} (pitcher, game_date);

create table if not exists {LOG_TABLE} (
    game_date date not null,
    row_count integer not null,
    source text not null,
    loaded_at timestamptz not null default now()
);
"""


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(ddl())


def _to_copy_buffer(df: pd.DataFrame) -> io.StringIO:
    buf = io.StringIO()
    df.to_csv(buf, index=False, header=False, na_rep="\\N")
    buf.seek(0)
    return buf


def load_frame(conn: psycopg.Connection, df: pd.DataFrame, source: str) -> int:
    """Replace the game dates present in df with df's rows. Returns rows written."""
    if df.empty:
        return 0
    df = df.copy()
    df["_source"] = source
    df["_loaded_at"] = pd.Timestamp.now(tz="UTC").isoformat()
    columns = list(COLUMNS) + list(METADATA_COLUMNS)
    dates = sorted(df["game_date"].unique())

    with conn.transaction():
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute(f"delete from {RAW_TABLE} where game_date = any(%s)", (dates,))
            deleted = cur.rowcount
            copy_sql = f"copy {RAW_TABLE} ({', '.join(columns)}) from stdin with (format csv, null '\\N')"
            with cur.copy(copy_sql) as copy:
                copy.write(_to_copy_buffer(df[columns]).read())
            counts = df.groupby("game_date").size()
            cur.executemany(
                f"insert into {LOG_TABLE} (game_date, row_count, source) values (%s, %s, %s)",
                [(d, int(n), source) for d, n in counts.items()],
            )
    log.info("Loaded %d rows for %d date(s) (replaced %d)", len(df), len(dates), deleted)
    return len(df)


def load_landed_file(conn: psycopg.Connection, path: Path, source: str) -> int:
    from .transform import conform

    df = conform(pd.read_csv(path, low_memory=False))
    return load_frame(conn, df, source=source)


def load_landed_files(conn: psycopg.Connection, paths: list[Path], source: str) -> int:
    """Load several landed days in one transaction, so a refresh window lands all or nothing."""
    from .transform import conform

    frames = [conform(pd.read_csv(p, low_memory=False)) for p in paths]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return 0
    return load_frame(conn, pd.concat(frames, ignore_index=True), source=source)
