import pytest

from statcast_lakehouse.bronze import to_bronze
from statcast_lakehouse.checks import run_checks
from statcast_lakehouse.gold import MARTS, build_gold
from statcast_lakehouse.silver import to_silver


@pytest.fixture(scope="module")
def layers(spark, raw_sample):
    bronze = to_bronze(raw_sample, "sample")
    silver = to_silver(bronze)
    gold = build_gold(spark, silver)
    return bronze, silver, gold


def test_every_mart_builds_and_has_rows(layers):
    _, _, gold = layers
    assert set(gold) == set(MARTS)
    for name, df in gold.items():
        assert df.count() > 0, name


def test_all_quality_checks_pass_on_sample(spark, layers):
    bronze, silver, gold = layers
    failures = run_checks(spark, {"bronze_pitches": bronze, "fct_pitches": silver, **gold})
    assert failures == []


def test_checks_catch_a_duplicate_pitch(spark, layers):
    bronze, silver, gold = layers
    duped = silver.unionByName(silver.limit(1))
    failures = run_checks(spark, {"bronze_pitches": bronze, "fct_pitches": duped, **gold})
    assert any("pitch_id is unique" in f for f in failures)


def test_arsenal_usage_is_a_share(layers):
    _, _, gold = layers
    rows = gold["mart_pitcher_arsenal"].collect()
    assert all(0 < r["usage_pct"] <= 1 for r in rows)


def test_game_trends_baseline_never_includes_the_game_itself(layers):
    _, _, gold = layers
    first_games = gold["mart_pitcher_game_trends"].where("prior_games = 0").collect()
    assert first_games
    assert all(r["velo_vs_baseline_mph"] is None and r["velo_drop_flag"] is False for r in first_games)
