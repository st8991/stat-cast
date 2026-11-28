"""Pull one day of pitch-level Statcast data and write it to the landing zone.

Baseball Savant's search endpoint returns CSV and caps a single query at 25,000
rows. A full MLB day is roughly 4,000-5,000 pitches, so one request per game
date stays far under the cap; hitting it means the result was truncated, and we
fail loudly rather than load a partial day.
"""

from __future__ import annotations

import gzip
import io
import logging
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

from .config import Settings
from .season import GAME_TYPE_CODES, hf_gt

log = logging.getLogger(__name__)

SAVANT_CSV_URL = "https://baseballsavant.mlb.com/statcast_search/csv"
SAVANT_ROW_CAP = 25_000
GAME_TYPES = GAME_TYPE_CODES  # kept for backwards compatibility


class TruncatedResultError(RuntimeError):
    """Savant returned exactly its row cap, so the day is probably incomplete."""


def savant_params(game_date: date, game_types: str = "regular") -> dict[str, str]:
    """Query parameters for one game date. game_types is comma-separated, e.g. "regular,postseason"."""
    d = game_date.isoformat()
    return {
        "all": "true",
        "type": "details",
        "player_type": "pitcher",
        "game_date_gt": d,
        "game_date_lt": d,
        "hfGT": hf_gt(game_types),
    }


def fetch_savant_csv(
    game_date: date,
    session: requests.Session | None = None,
    retries: int = 4,
    backoff_seconds: float = 5.0,
    timeout: float = 120.0,
    game_types: str = "regular",
) -> bytes:
    """Return the raw CSV bytes for one game date, retrying transient failures."""
    session = session or requests.Session()
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(SAVANT_CSV_URL, params=savant_params(game_date, game_types), timeout=timeout)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {resp.status_code}", response=resp)
            resp.raise_for_status()
            return resp.content
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as exc:
            last_error = exc
            if attempt == retries:
                break
            wait = backoff_seconds * 2 ** (attempt - 1)
            log.warning("Savant request for %s failed (%s); retry %d in %.0fs", game_date, exc, attempt, wait)
            time.sleep(wait)
    raise RuntimeError(f"Savant request for {game_date} failed after {retries} attempts") from last_error


def parse_csv(content: bytes) -> pd.DataFrame:
    """Parse Savant CSV bytes. An off day comes back empty or header-only."""
    text = content.decode("utf-8-sig").strip()
    if not text:
        return pd.DataFrame()
    return pd.read_csv(io.StringIO(text), low_memory=False)


def read_sample(sample_file: Path, game_date: date) -> pd.DataFrame:
    """Replay one day from the committed synthetic sample (offline mode)."""
    df = pd.read_csv(sample_file, low_memory=False)
    return df[df["game_date"] == game_date.isoformat()].reset_index(drop=True)


def landing_path(landing_dir: Path, game_date: date) -> Path:
    return landing_dir / f"game_date={game_date.isoformat()}" / "statcast.csv.gz"


def extract_day(
    game_date: date, settings: Settings, session: requests.Session | None = None
) -> tuple[Path | None, int]:
    """Fetch one day and write it to the landing zone.

    Returns (path, row_count). path is None on a day with no pitches.
    """
    if settings.source == "sample":
        df = read_sample(settings.sample_file, game_date)
    elif settings.source == "savant":
        df = parse_csv(fetch_savant_csv(game_date, session=session, game_types=settings.game_types))
    else:
        raise ValueError(f"Unknown STATCAST_SOURCE {settings.source!r}")

    if len(df) >= SAVANT_ROW_CAP:
        raise TruncatedResultError(f"{game_date}: {len(df)} rows hits the Savant cap; split the query")

    if df.empty:
        log.info("%s: no pitches (off day)", game_date)
        return None, 0

    path = landing_path(settings.landing_dir, game_date)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8", newline="") as fh:
        df.to_csv(fh, index=False)
    tmp.replace(path)  # atomic: a half-written file never looks like a landed day
    log.info("%s: landed %d rows at %s", game_date, len(df), path)
    return path, len(df)
