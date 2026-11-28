"""Landing-zone versions for the Databricks pipeline (plain Python; lives here because it's lakehouse code)."""

import gzip
from datetime import UTC, datetime

from statcast_lakehouse.config import landing_file_name as legacy_name
from statcast_lakehouse.landing import landed_versions, landing_file_name, write_landed

DAY = "2025-06-02"


def _read(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return fh.read()


def test_first_landing_keeps_the_plain_name(tmp_path):
    path = write_landed(str(tmp_path), DAY, "game_pk\n1\n")
    assert path.endswith("statcast_2025-06-02.csv.gz")
    assert legacy_name(DAY) == landing_file_name(DAY)


def test_unchanged_repull_is_not_landed_again(tmp_path):
    write_landed(str(tmp_path), DAY, "game_pk\n1\n")
    assert write_landed(str(tmp_path), DAY, "game_pk\n1\n") is None
    assert len(landed_versions(str(tmp_path), DAY)) == 1


def test_corrected_repull_lands_a_newer_version(tmp_path):
    t1 = datetime(2025, 6, 3, 14, 0, tzinfo=UTC)
    t2 = datetime(2025, 6, 4, 14, 0, tzinfo=UTC)
    write_landed(str(tmp_path), DAY, "game_pk\n1\n")
    write_landed(str(tmp_path), DAY, "game_pk\n2\n", now=t1)
    newest = write_landed(str(tmp_path), DAY, "game_pk\n3\n", now=t2)
    versions = landed_versions(str(tmp_path), DAY)
    assert len(versions) == 3 and versions[-1] == newest
    assert newest.endswith("statcast_2025-06-02__20250604T140000Z.csv.gz")
    # Silver breaks ingest-time ties on the file name, so newer versions must sort after older ones.
    assert sorted(versions) == versions
    assert _read(newest) == "game_pk\n3\n"
    # Going back to an earlier version's content is still a change from the newest one.
    assert write_landed(str(tmp_path), DAY, "game_pk\n1\n", now=datetime.now(UTC)) is not None


def test_versions_only_match_their_own_day(tmp_path):
    write_landed(str(tmp_path), DAY, "a\n1\n")
    write_landed(str(tmp_path), "2025-06-03", "a\n1\n")
    (tmp_path / "statcast_2025-06-02.csv.gz.tmp").write_text("partial")
    assert [p.rsplit("/", 1)[-1] for p in landed_versions(str(tmp_path), DAY)] == ["statcast_2025-06-02.csv.gz"]
    assert landed_versions(str(tmp_path / "missing"), DAY) == []
