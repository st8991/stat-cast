"""The curated slice of the Statcast CSV that lands in raw.statcast_pitches.

Savant's CSV has 100+ columns and gains new ones over time (arm_angle arrived in
2024). We keep a fixed, typed contract: unknown columns are dropped and logged,
missing ones arrive as NULL. The full original CSV is kept in the landing zone,
so adding a column later is a backfill, not a re-download.
"""

from __future__ import annotations

# column -> Postgres type. Order is the table's column order.
COLUMNS: dict[str, str] = {
    # keys and game context
    "game_pk": "integer",
    "game_date": "date",
    "game_year": "smallint",
    "game_type": "text",
    "at_bat_number": "smallint",
    "pitch_number": "smallint",
    "inning": "smallint",
    "inning_topbot": "text",
    "outs_when_up": "smallint",
    "balls": "smallint",
    "strikes": "smallint",
    "home_team": "text",
    "away_team": "text",
    # who
    "pitcher": "integer",
    "player_name": "text",
    "batter": "integer",
    "p_throws": "text",
    "stand": "text",
    # pitch characteristics
    "pitch_type": "text",
    "pitch_name": "text",
    "release_speed": "real",
    "effective_speed": "real",
    "release_spin_rate": "real",
    "spin_axis": "real",
    "release_extension": "real",
    "release_pos_x": "real",
    "release_pos_y": "real",
    "release_pos_z": "real",
    "arm_angle": "real",
    "pfx_x": "real",
    "pfx_z": "real",
    "plate_x": "real",
    "plate_z": "real",
    "sz_top": "real",
    "sz_bot": "real",
    "zone": "smallint",
    # outcome
    "type": "text",
    "description": "text",
    "events": "text",
    "bb_type": "text",
    "launch_speed": "real",
    "launch_angle": "real",
    "estimated_woba_using_speedangle": "real",
    "woba_value": "real",
    "delta_run_exp": "real",
}

PRIMARY_KEY = ("game_pk", "at_bat_number", "pitch_number")

# Columns the loader adds.
METADATA_COLUMNS: dict[str, str] = {
    "_source": "text",
    "_loaded_at": "timestamptz",
}

INTEGER_TYPES = {"integer", "smallint"}
FLOAT_TYPES = {"real", "double precision"}
