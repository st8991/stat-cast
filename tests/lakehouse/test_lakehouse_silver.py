from datetime import date, datetime

from statcast_lakehouse.schema import CONTRACT
from statcast_lakehouse.silver import conform, stage, to_silver


def _bronze_row(**overrides):
    base = {c: None for c in CONTRACT}
    base.update(
        game_pk="900001", game_date="2025-06-02", game_year="2025", at_bat_number="1",
        pitch_number="1", inning_topbot="Top", home_team="RVR", away_team="LKS",
        pitcher="990001", player_name="Hale, Dorian", p_throws="R", pitch_type="FF",
        release_speed="96.2", pfx_x="-0.5", pfx_z="1.0", zone="6", description="swinging_strike",
        delta_run_exp="-0.05", balls="0", strikes="1",
    )
    base.update(overrides)
    base["_ingested_at"] = base.get("_ingested_at") or datetime(2026, 1, 1)
    base["_source_file"] = base.get("_source_file")
    return base


def _df(spark, rows):
    cols = list(rows[0].keys())
    schema = ", ".join(
        f"`{c}` timestamp" if c == "_ingested_at" else f"`{c}` string" for c in cols
    )
    return spark.createDataFrame([tuple(r[c] for c in cols) for r in rows], schema)


def test_conform_types_values_and_bad_numbers_become_null(spark):
    df = _df(spark, [_bronze_row(release_speed="not a number", zone="6.0")])
    row = conform(df).collect()[0]
    assert row["game_pk"] == 900001
    assert row["game_date"] == date(2025, 6, 2)
    assert row["release_speed"] is None
    assert row["zone"] == 6


def test_conform_drops_rows_without_full_key(spark):
    df = _df(spark, [_bronze_row(), _bronze_row(pitch_number=None, at_bat_number="2")])
    assert conform(df).count() == 1


def test_conform_keeps_latest_version_of_a_pitch(spark):
    old = _bronze_row(pitch_type="SL", _ingested_at=datetime(2026, 1, 1))
    new = _bronze_row(pitch_type="FF", _ingested_at=datetime(2026, 1, 2))
    rows = conform(_df(spark, [old, new])).collect()
    assert len(rows) == 1 and rows[0]["pitch_type"] == "FF"


def test_stage_movement_flags_and_ids(spark):
    df = _df(spark, [_bronze_row()])
    row = stage(conform(df)).collect()[0]
    assert row["pitch_id"] == "900001-1-1"
    assert row["horz_break_in"] == -6.0
    assert row["arm_side_break_in"] == 6.0  # righty: flip sign so arm side is positive
    assert row["induced_vert_break_in"] == 12.0
    assert row["pitching_team"] == "RVR"
    assert row["count_state"] == "0-1"
    assert row["is_swing"] and row["is_whiff"] and row["is_csw"]
    assert row["is_in_zone"] and not row["is_chase"]
    assert row["pitcher_run_value"] == 0.05


def test_stage_lefty_arm_side_and_chase(spark):
    df = _df(spark, [_bronze_row(p_throws="L", pfx_x="0.5", zone="13", description="foul")])
    row = stage(conform(df)).collect()[0]
    assert row["arm_side_break_in"] == 6.0
    assert row["is_chase"] and not row["is_in_zone"]


def test_stage_drops_untracked_pitches(spark):
    df = _df(spark, [_bronze_row(pitch_type=None)])
    assert stage(conform(df)).count() == 0


def test_sample_week_reaches_silver(spark, raw_sample):
    from statcast_lakehouse.bronze import to_bronze

    silver = to_silver(to_bronze(raw_sample, "sample"))
    n = silver.count()
    assert n > 1000
    assert silver.select("pitch_id").distinct().count() == n
