from datetime import date

import pytest

from statcast_pipeline import season


def test_game_types_parse_and_combine():
    assert season.parse_game_types("regular, postseason") == ("regular", "postseason")
    assert season.parse_game_types(None) == ("regular",)
    assert season.hf_gt("regular,postseason") == "R|F|D|L|W|"
    assert season.hf_gt("spring") == "S|"


def test_unknown_game_type_fails_loudly():
    with pytest.raises(ValueError):
        season.parse_game_types("regular,playoffs")
    with pytest.raises(ValueError):
        season.parse_game_types(" , ")


@pytest.mark.parametrize(
    ("d", "game_types", "expected"),
    [
        (date(2025, 6, 1), "regular", True),
        (date(2025, 11, 28), "regular", False),
        (date(2025, 1, 15), "regular,postseason,spring", False),
        (date(2025, 10, 25), "regular", False),
        (date(2025, 10, 25), "regular,postseason", True),
        (date(2025, 3, 1), "spring", True),
        (date(2025, 3, 1), "regular", False),
    ],
)
def test_in_season(d, game_types, expected):
    assert season.in_season(d, game_types) is expected


def test_refresh_window_ends_at_target_oldest_first():
    assert season.refresh_dates(date(2025, 6, 3), 3) == [date(2025, 6, 1), date(2025, 6, 2), date(2025, 6, 3)]
    assert season.refresh_dates(date(2025, 6, 3), 1) == [date(2025, 6, 3)]
    with pytest.raises(ValueError):
        season.refresh_dates(date(2025, 6, 3), 0)


def test_last_days_of_a_season_still_get_refreshed():
    # Oct 6-8: the regular-season window ends Oct 5, but a run on Oct 7 still re-pulls Oct 5.
    window = season.refresh_dates(date(2025, 10, 7), 3)
    assert season.any_in_season(window, "regular")
    assert not season.any_in_season(season.refresh_dates(date(2025, 10, 9), 3), "regular")
