from dataclasses import replace
from datetime import date

import pandas as pd
import pytest
import requests

from statcast_pipeline import extract
from statcast_pipeline.config import Settings


class FakeResponse:
    def __init__(self, status=200, content=b""):
        self.status_code = status
        self.content = content

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append(params)
        return self.responses.pop(0)


def test_params_ask_for_one_regular_season_day():
    p = extract.savant_params(date(2025, 6, 1))
    assert p["game_date_gt"] == p["game_date_lt"] == "2025-06-01"
    assert p["hfGT"] == "R|" and p["type"] == "details"


def test_game_types_reach_the_savant_request(monkeypatch, tmp_path):
    session = FakeSession([FakeResponse(200, b"")])
    settings = replace(Settings(), source="savant", landing_dir=tmp_path, game_types="regular,postseason")
    extract.extract_day(date(2025, 10, 20), settings, session=session)
    assert session.calls[0]["hfGT"] == "R|F|D|L|W|"


def test_transient_errors_are_retried(monkeypatch):
    monkeypatch.setattr(extract.time, "sleep", lambda s: None)
    session = FakeSession([FakeResponse(503), FakeResponse(200, b"game_pk\n1\n")])
    assert extract.fetch_savant_csv(date(2025, 6, 1), session=session) == b"game_pk\n1\n"
    assert len(session.calls) == 2


def test_gives_up_after_retries(monkeypatch):
    monkeypatch.setattr(extract.time, "sleep", lambda s: None)
    session = FakeSession([FakeResponse(503)] * 3)
    with pytest.raises(RuntimeError):
        extract.fetch_savant_csv(date(2025, 6, 1), session=session, retries=3)


def test_empty_response_is_an_off_day():
    assert extract.parse_csv(b"").empty
    assert extract.parse_csv(b"\xef\xbb\xbf\n").empty


def test_off_day_writes_nothing(tmp_path, sample_file):
    settings = replace(Settings(), source="sample", sample_file=sample_file, landing_dir=tmp_path)
    path, rows = extract.extract_day(date(2025, 6, 5), settings)
    assert path is None and rows == 0
    assert not any(tmp_path.iterdir())


def test_game_day_lands_a_partitioned_file(tmp_path, sample_file):
    settings = replace(Settings(), source="sample", sample_file=sample_file, landing_dir=tmp_path)
    path, rows = extract.extract_day(date(2025, 6, 2), settings)
    assert path == tmp_path / "game_date=2025-06-02" / "statcast.csv.gz"
    assert len(pd.read_csv(path)) == rows > 0


def test_hitting_the_row_cap_fails_loudly(tmp_path, monkeypatch):
    big = pd.DataFrame({"game_pk": range(extract.SAVANT_ROW_CAP)})
    monkeypatch.setattr(extract, "read_sample", lambda f, d: big)
    settings = replace(Settings(), source="sample", landing_dir=tmp_path)
    with pytest.raises(extract.TruncatedResultError):
        extract.extract_day(date(2025, 6, 2), settings)
