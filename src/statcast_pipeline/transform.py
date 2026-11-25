"""Conform a landed Statcast frame to the raw table contract."""

from __future__ import annotations

import logging

import pandas as pd

from .schema import COLUMNS, FLOAT_TYPES, INTEGER_TYPES, PRIMARY_KEY

log = logging.getLogger(__name__)


def conform(df: pd.DataFrame) -> pd.DataFrame:
    """Select, type and de-duplicate columns so the frame matches raw.statcast_pitches.

    - unknown columns are dropped (and logged once), missing ones become NULL
    - numbers are coerced; values that won't parse become NULL, not errors
    - rows without a full primary key are dropped
    - duplicate pitches keep the last occurrence (Savant occasionally repeats rows)
    """
    extra = sorted(set(df.columns) - set(COLUMNS))
    if extra:
        log.info("Dropping %d columns not in the contract: %s", len(extra), ", ".join(extra[:10]))
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        log.info("Filling %d missing columns with NULL: %s", len(missing), ", ".join(missing))

    out = df.reindex(columns=list(COLUMNS)).copy()

    for col, pg_type in COLUMNS.items():
        if pg_type in INTEGER_TYPES:
            out[col] = pd.to_numeric(out[col], errors="coerce").astype("Int64")
        elif pg_type in FLOAT_TYPES:
            out[col] = pd.to_numeric(out[col], errors="coerce").astype("float64")
        elif pg_type == "date":
            out[col] = pd.to_datetime(out[col], errors="coerce").dt.date
        else:
            out[col] = out[col].astype("string").str.strip().replace({"": pd.NA})

    before = len(out)
    out = out.dropna(subset=list(PRIMARY_KEY) + ["game_date"])
    if len(out) < before:
        log.warning("Dropped %d rows missing a primary key", before - len(out))

    before = len(out)
    out = out.drop_duplicates(subset=list(PRIMARY_KEY), keep="last")
    if len(out) < before:
        log.info("Dropped %d duplicate pitches", before - len(out))

    return out.reset_index(drop=True)
