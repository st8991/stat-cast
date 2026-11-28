"""Which game types to pull, when MLB plays them, and which dates a daily run covers.

Shared by the Airflow DAG, the CLI and the Databricks landing notebook, so both
pipelines agree on what "in season" and "the refresh window" mean.
"""

from __future__ import annotations

from datetime import date, timedelta

# Savant's hfGT codes. Postseason covers wild card (F), division (D), league (L) and World Series (W).
GAME_TYPE_CODES = {"regular": "R|", "postseason": "F|D|L|W|", "spring": "S|"}

# Generous calendar windows (month, day) for each game type. They only decide whether a
# *scheduled* run calls Savant at all, so they lean wide: a few empty calls at the edges
# are harmless, a missed opening day is not. Explicit dates and backfills ignore them.
SEASON_WINDOWS: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {
    "spring": ((2, 15), (3, 31)),
    "regular": ((3, 15), (10, 5)),
    "postseason": ((9, 28), (11, 10)),
}


def parse_game_types(value: str | None) -> tuple[str, ...]:
    """Parse a comma-separated list like "regular,postseason" into known game types."""
    names = tuple(dict.fromkeys(p.strip().lower() for p in (value or "regular").split(",") if p.strip()))
    unknown = [n for n in names if n not in GAME_TYPE_CODES]
    if unknown or not names:
        raise ValueError(f"Unknown game type(s) {unknown or value!r}; choose from {sorted(GAME_TYPE_CODES)}")
    return names


def hf_gt(game_types: str | tuple[str, ...]) -> str:
    """Savant's hfGT filter for one or more game types, e.g. "R|F|D|L|W|"."""
    names = parse_game_types(game_types) if isinstance(game_types, str) else game_types
    return "".join(GAME_TYPE_CODES[n] for n in names)


def in_season(game_date: date, game_types: str | tuple[str, ...]) -> bool:
    """True if game_date falls in the calendar window of any of the game types."""
    names = parse_game_types(game_types) if isinstance(game_types, str) else game_types
    md = (game_date.month, game_date.day)
    return any(SEASON_WINDOWS[n][0] <= md <= SEASON_WINDOWS[n][1] for n in names)


def refresh_dates(target: date, days: int) -> list[date]:
    """The `days` game dates ending at target, oldest first.

    Savant revises pitch types and run values for a day or two after a game, so a
    daily run re-pulls the trailing window instead of only yesterday.
    """
    if days < 1:
        raise ValueError(f"refresh days must be at least 1, got {days}")
    return [target - timedelta(days=i) for i in range(days - 1, -1, -1)]


def any_in_season(dates: list[date], game_types: str | tuple[str, ...]) -> bool:
    """True if any date in the window is in season, so the last days of a season still get refreshed."""
    return any(in_season(d, game_types) for d in dates)
