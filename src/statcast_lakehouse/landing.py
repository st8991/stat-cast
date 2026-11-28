"""Landing-zone bookkeeping for the Databricks pipeline: file names, versions and change detection.

Auto Loader only reads a file name once, so a corrected day can't overwrite its old
file. Instead each re-pull that changed lands as a new version of the day,
`statcast_YYYY-MM-DD__<pulled-at UTC>.csv.gz`. Silver keeps the newest version of
each pitch (latest ingest time, then the later file name), so the correction wins.
A re-pull that matches the newest landed version is not landed again.
"""

from __future__ import annotations

import gzip
import hashlib
import os
import re
from datetime import UTC, datetime

_VERSIONED = re.compile(r"^statcast_(\d{4}-\d{2}-\d{2})(?:__(\d{8}T\d{6}Z))?\.csv\.gz$")


def landing_file_name(game_date: str, pulled_at: datetime | None = None) -> str:
    """The first landing of a day has no suffix; later versions carry the pull time, which sorts after it."""
    if pulled_at is None:
        return f"statcast_{game_date}.csv.gz"
    stamp = pulled_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"statcast_{game_date}__{stamp}.csv.gz"


def landed_versions(landing_dir: str, game_date: str) -> list[str]:
    """Paths of every landed version of game_date, oldest first."""
    if not os.path.isdir(landing_dir):
        return []
    found = []
    for name in os.listdir(landing_dir):
        m = _VERSIONED.match(name)
        if m and m.group(1) == game_date:
            found.append((m.group(2) or "", name))
    return [os.path.join(landing_dir, name) for _, name in sorted(found)]


def content_hash(csv_text: str) -> str:
    return hashlib.sha256(csv_text.encode("utf-8")).hexdigest()


def landed_hash(path: str) -> str:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
        return content_hash(fh.read())


def write_landed(landing_dir: str, game_date: str, csv_text: str, now: datetime | None = None) -> str | None:
    """Land csv_text for game_date unless the newest landed version already has the same content.

    Returns the new path, or None when nothing changed. Writes to a temp name and renames,
    so a half-written file never looks landed.
    """
    versions = landed_versions(landing_dir, game_date)
    if versions and landed_hash(versions[-1]) == content_hash(csv_text):
        return None
    pulled_at = (now or datetime.now(UTC)) if versions else None
    path = os.path.join(landing_dir, landing_file_name(game_date, pulled_at))
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8", newline="") as fh:
        fh.write(csv_text)
    os.replace(tmp, path)
    return path
