"""Read-only queries behind the dashboard.

Everything comes from the dbt marts (plus a sample of `fct_pitches` for the
per-pitch scatter plots), the loader's audit table, and, if it is reachable,
Airflow's own metadata database for the latest DAG runs.
"""

from __future__ import annotations

import datetime as dt
import decimal
import logging
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger(__name__)

DAG_ID = "statcast_daily"
DAG_TZ = "America/Chicago"
# Per-pitch points drawn on the movement and release plots for one pitcher.
MAX_PITCH_POINTS = 1500

MART_TABLES = [
    "raw.statcast_pitches",
    "marts.fct_pitches",
    "marts.dim_pitchers",
    "marts.mart_pitcher_arsenal",
    "marts.mart_pitch_movement",
    "marts.mart_release_consistency",
    "marts.mart_pitcher_game_trends",
]


def _clean(value: Any) -> Any:
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    return value


def _rows(conn: psycopg.Connection, sql: str, params: Any = None) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return [{k: _clean(v) for k, v in row.items()} for row in cur.fetchall()]


def seasons(conn: psycopg.Connection) -> list[int]:
    return [r["season"] for r in _rows(conn, "select distinct season from marts.fct_pitches order by season desc")]


def overview(conn: psycopg.Connection, season: int | None = None) -> dict:
    """Everything the dashboard needs before a pitcher is picked."""
    all_seasons = seasons(conn)
    season = season or (all_seasons[0] if all_seasons else None)

    pitchers = _rows(
        conn,
        """
        with season_pitches as (
            select pitcher_id, count(*) as pitches, count(distinct game_pk) as games, max(game_date) as last_game_date
            from marts.fct_pitches where season = %(season)s group by pitcher_id
        ),
        primary_type as (
            select distinct on (pitcher_id) pitcher_id, pitch_type as primary_pitch_type
            from marts.mart_pitcher_arsenal where season = %(season)s
            order by pitcher_id, usage_pct desc, pitch_type
        ),
        latest_game as (
            select distinct on (pitcher_id) pitcher_id, fb_velo_mph, velo_vs_baseline_mph, velo_drop_flag
            from marts.mart_pitcher_game_trends where season = %(season)s
            order by pitcher_id, game_date desc, game_pk desc
        ),
        any_flag as (
            select pitcher_id, bool_or(velo_drop_flag) as any_velo_drop
            from marts.mart_pitcher_game_trends where season = %(season)s group by pitcher_id
        ),
        spark as (
            select pitcher_id, json_agg(fb_velo_mph order by game_date, game_pk) as fb_velo_by_game
            from marts.mart_pitcher_game_trends where season = %(season)s group by pitcher_id
        )
        select
            d.pitcher_id, d.pitcher_name, d.pitcher_hand, d.latest_team,
            s.pitches, s.games, s.last_game_date,
            p.primary_pitch_type,
            g.fb_velo_mph as last_fb_velo_mph, g.velo_vs_baseline_mph as last_velo_vs_baseline_mph,
            coalesce(g.velo_drop_flag, false) as last_game_velo_drop,
            coalesce(f.any_velo_drop, false) as any_velo_drop,
            coalesce(k.fb_velo_by_game, '[]'::json) as fb_velo_by_game
        from season_pitches s
        join marts.dim_pitchers d using (pitcher_id)
        left join primary_type p using (pitcher_id)
        left join latest_game g using (pitcher_id)
        left join any_flag f using (pitcher_id)
        left join spark k using (pitcher_id)
        order by s.pitches desc, d.pitcher_name
        """,
        {"season": season},
    )

    leaders = {
        "velo": _rows(
            conn,
            """
            select pitcher_id, pitcher_name, pitch_type, avg_velo_mph as value
            from marts.mart_pitcher_arsenal
            where season = %(season)s and pitch_type in ('FF', 'SI', 'FC')
            order by avg_velo_mph desc nulls last limit 5
            """,
            {"season": season},
        ),
        "ride": _rows(
            conn,
            """
            select pitcher_id, pitcher_name, pitch_type, ivb_vs_league_in as value
            from marts.mart_pitch_movement
            where season = %(season)s and pitch_type = 'FF'
            order by ivb_vs_league_in desc nulls last limit 5
            """,
            {"season": season},
        ),
        "whiff": _rows(
            conn,
            """
            select pitcher_id, pitcher_name, pitch_type, whiff_pct as value
            from marts.mart_pitcher_arsenal
            where season = %(season)s and whiff_pct is not null
            order by whiff_pct desc limit 5
            """,
            {"season": season},
        ),
        "consistency": _rows(
            conn,
            """
            select pitcher_id, pitcher_name, primary_pitch_type as pitch_type, release_spread_in as value
            from marts.mart_release_consistency
            where season = %(season)s
            order by release_spread_in asc nulls last limit 5
            """,
            {"season": season},
        ),
    }

    league_shape = _rows(
        conn,
        """
        select pitch_type, max(pitch_name) as pitch_name, count(*) as pitches,
               round(avg(velo_mph)::numeric, 1) as velo_mph,
               round(avg(induced_vert_break_in)::numeric, 1) as ivb_in,
               round(avg(arm_side_break_in)::numeric, 1) as arm_side_break_in
        from marts.fct_pitches where season = %(season)s
        group by pitch_type order by count(*) desc
        """,
        {"season": season},
    )

    alerts = _rows(
        conn,
        """
        select pitcher_id, pitcher_name, game_date, fb_velo_mph, velo_vs_baseline_mph
        from marts.mart_pitcher_game_trends
        where season = %(season)s and velo_drop_flag
        order by game_date desc, velo_vs_baseline_mph
        """,
        {"season": season},
    )

    totals = _rows(
        conn,
        """
        select count(*) as pitches, count(distinct pitcher_id) as pitchers, count(distinct game_pk) as games,
               min(game_date) as first_game_date, max(game_date) as last_game_date
        from marts.fct_pitches where season = %(season)s
        """,
        {"season": season},
    )[0]

    return {
        "season": season,
        "seasons": all_seasons,
        "totals": totals,
        "pitchers": pitchers,
        "leaders": leaders,
        "league_shape": league_shape,
        "alerts": alerts,
    }


def pitcher(conn: psycopg.Connection, pitcher_id: int, season: int | None = None) -> dict | None:
    """One pitcher's arsenal, movement vs league, release, game trends and a sample of pitches."""
    profile = _rows(conn, "select * from marts.dim_pitchers where pitcher_id = %s", (pitcher_id,))
    if not profile:
        return None
    if season is None:
        found = _rows(
            conn, "select max(season) as season from marts.fct_pitches where pitcher_id = %s", (pitcher_id,)
        )
        season = found[0]["season"]
    params = {"pid": pitcher_id, "season": season}

    arsenal = _rows(
        conn,
        """
        select a.*, m.velo_vs_league_mph, m.ivb_vs_league_in, m.arm_side_vs_league_in, m.ivb_z, m.arm_side_z
        from marts.mart_pitcher_arsenal a
        left join marts.mart_pitch_movement m using (season, pitcher_id, pitch_type)
        where a.pitcher_id = %(pid)s and a.season = %(season)s
        order by a.usage_pct desc, a.pitch_type
        """,
        params,
    )
    release = _rows(
        conn,
        "select * from marts.mart_release_consistency where pitcher_id = %(pid)s and season = %(season)s",
        params,
    )
    trends = _rows(
        conn,
        """
        select game_pk, game_date, fastballs, fb_velo_mph, fb_max_velo_mph, release_z_ft, extension_ft,
               prior_games, velo_vs_baseline_mph, release_z_vs_baseline_in, velo_drop_flag
        from marts.mart_pitcher_game_trends
        where pitcher_id = %(pid)s and season = %(season)s
        order by game_date, game_pk
        """,
        params,
    )
    pitches = _rows(
        conn,
        """
        select pitch_type, velo_mph, induced_vert_break_in as ivb_in, arm_side_break_in,
               release_x_ft, release_z_ft, plate_x_ft, plate_z_ft, is_whiff, is_csw
        from marts.fct_pitches
        where pitcher_id = %(pid)s and season = %(season)s
          and induced_vert_break_in is not null and arm_side_break_in is not null
        order by md5(pitch_id)  -- stable pseudo-random sample
        limit %(limit)s
        """,
        {**params, "limit": MAX_PITCH_POINTS},
    )
    # Release cloud of the whole league, so this pitcher's spread has context.
    league_release = _rows(
        conn,
        """
        select round(avg(release_spread_in)::numeric, 2) as avg_release_spread_in,
               round(avg(max_tunnel_gap_in)::numeric, 2) as avg_max_tunnel_gap_in
        from marts.mart_release_consistency where season = %(season)s
        """,
        params,
    )
    return {
        "season": season,
        "profile": profile[0],
        "arsenal": arsenal,
        "release": release[0] if release else None,
        "league_release": league_release[0] if league_release else None,
        "trends": trends,
        "pitches": pitches,
    }


def warehouse_health(conn: psycopg.Connection) -> dict:
    counts = []
    for table in MART_TABLES:
        try:
            with conn.cursor() as cur:
                cur.execute(f"select count(*) from {table}")  # table names are constants above
                counts.append({"table": table, "rows": cur.fetchone()[0]})
        except psycopg.Error:
            conn.rollback()
            counts.append({"table": table, "rows": None})

    freshness = _rows(
        conn,
        """
        select max(_loaded_at) as last_loaded_at, max(game_date) as last_game_date,
               extract(epoch from now() - max(_loaded_at)) / 3600.0 as hours_since_load
        from raw.statcast_pitches
        """,
    )[0]
    loads = _rows(
        conn,
        """
        select game_date, row_count, source, loaded_at
        from raw.ingestion_log
        order by loaded_at desc, game_date desc
        limit 30
        """,
    )
    rows_by_date = _rows(
        conn,
        """
        select game_date, count(*) as pitches, count(distinct game_pk) as games
        from raw.statcast_pitches
        group by game_date order by game_date desc limit 21
        """,
    )
    if freshness.get("hours_since_load") is not None:
        freshness["hours_since_load"] = round(float(freshness["hours_since_load"]), 1)
    # Same threshold as the dbt source freshness check (warn_after: 36 hours).
    freshness["warn_after_hours"] = 36
    return {
        "table_counts": counts,
        "freshness": freshness,
        "recent_loads": loads,
        "rows_by_date": list(reversed(rows_by_date)),
    }


def airflow_runs(dsn: str | None, limit: int = 14) -> dict:
    """Latest runs of the DAG and their task states, read from Airflow's metadata DB."""
    if not dsn:
        return {"available": False, "reason": "AIRFLOW_DB_DSN is not set"}
    try:
        with psycopg.connect(dsn, connect_timeout=3) as conn:
            runs = _rows(
                conn,
                """
                select run_id, run_type, state, logical_date, run_after, start_date, end_date,
                       conf ->> 'game_date' as conf_game_date
                from dag_run where dag_id = %s
                order by coalesce(start_date, run_after) desc nulls last
                limit %s
                """,
                (DAG_ID, limit),
            )
            tasks = _rows(
                conn,
                """
                select run_id, task_id, state, try_number, start_date, end_date
                from task_instance where dag_id = %s and run_id = any(%s)
                """,
                (DAG_ID, [r["run_id"] for r in runs]),
            )
    except (psycopg.Error, ValueError) as exc:
        log.warning("Airflow metadata DB unavailable: %s", exc)
        return {"available": False, "reason": str(exc).splitlines()[0][:200]}

    by_run: dict[str, list[dict]] = {}
    for t in tasks:
        by_run.setdefault(t.pop("run_id"), []).append(t)
    for r in runs:
        r["tasks"] = sorted(by_run.get(r["run_id"], []), key=lambda t: TASK_ORDER.get(t["task_id"], 99))
        r["game_date"] = r.pop("conf_game_date") or _default_game_date(r.get("logical_date") or r.get("run_after"))
        if r.get("start_date") and r.get("end_date"):
            r["duration_s"] = round(
                (dt.datetime.fromisoformat(r["end_date"]) - dt.datetime.fromisoformat(r["start_date"])).total_seconds(),
                1,
            )
    return {"available": True, "dag_id": DAG_ID, "runs": runs}


TASK_ORDER = {"resolve_game_date": 0, "extract": 1, "has_pitches": 2, "load": 3, "dbt_build": 4}


def _default_game_date(run_at: str | None) -> str | None:
    """Mirror the DAG's resolve_game_date: the day before the run, in the DAG's time zone."""
    if not run_at:
        return None
    local = dt.datetime.fromisoformat(run_at).astimezone(ZoneInfo(DAG_TZ))
    return (local.date() - dt.timedelta(days=1)).isoformat()
