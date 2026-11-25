import pandas as pd

from statcast_pipeline.schema import COLUMNS
from statcast_pipeline.transform import conform


def _row(**overrides):
    row = {"game_pk": 1, "game_date": "2025-06-01", "at_bat_number": 1, "pitch_number": 1,
           "pitcher": 10, "pitch_type": "FF", "release_speed": "95.1"}
    row.update(overrides)
    return row


def test_output_matches_contract_columns_and_order():
    out = conform(pd.DataFrame([_row(unknown_col="x", **{"pitcher.1": 10})]))
    assert list(out.columns) == list(COLUMNS)


def test_missing_columns_become_null():
    out = conform(pd.DataFrame([_row()]))
    assert out["arm_angle"].isna().all()


def test_numbers_are_coerced_and_bad_values_become_null():
    out = conform(pd.DataFrame([_row(), _row(pitch_number=2, release_speed="n/a")]))
    assert out["release_speed"].tolist()[0] == 95.1
    assert pd.isna(out["release_speed"].tolist()[1])
    assert str(out["pitch_number"].dtype) == "Int64"


def test_rows_without_a_primary_key_are_dropped():
    out = conform(pd.DataFrame([_row(), _row(pitch_number=None)]))
    assert len(out) == 1


def test_duplicate_pitches_keep_the_last_version():
    out = conform(pd.DataFrame([_row(pitch_type="SL"), _row(pitch_type="FF")]))
    assert len(out) == 1 and out.loc[0, "pitch_type"] == "FF"


def test_sample_file_conforms_cleanly(sample_file):
    raw = pd.read_csv(sample_file)
    out = conform(raw)
    assert len(out) == len(raw) - 1  # the sample carries one deliberate duplicate
    assert out["p_throws"].isin(["R", "L"]).all()
