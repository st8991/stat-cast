"""Data quality checks, ported from stat-cast's dbt tests.

Each check is a query that returns offending rows; zero rows means it passed.
`run_checks` returns the failures so the notebook (or a test) decides what to do.
"""

from __future__ import annotations

from dataclasses import dataclass

from pyspark.sql import DataFrame, SparkSession


@dataclass(frozen=True)
class Check:
    name: str
    sql: str


CHECKS: list[Check] = [
    Check(
        "silver pitch_id is unique and not null",
        "select pitch_id, count(*) as n from fct_pitches group by pitch_id "
        "having pitch_id is null or count(*) > 1",
    ),
    Check(
        "dim_pitchers pitcher_id is unique",
        "select pitcher_id from dim_pitchers group by pitcher_id having count(*) > 1",
    ),
    Check(
        "dim_pitchers pitcher_hand is R or L",
        "select pitcher_id, pitcher_hand from dim_pitchers "
        "where pitcher_hand is null or pitcher_hand not in ('R', 'L')",
    ),
    Check(
        "every silver pitcher is in dim_pitchers",
        "select distinct f.pitcher_id from fct_pitches f "
        "left anti join dim_pitchers d on f.pitcher_id = d.pitcher_id",
    ),
    Check(
        "arsenal grain (season, pitcher, pitch type) is unique",
        "select season, pitcher_id, pitch_type from mart_pitcher_arsenal "
        "group by season, pitcher_id, pitch_type having count(*) > 1",
    ),
    Check(
        # Usage is a share of all the pitcher's pitches, so it can sum to less than 1
        # (rare pitches are filtered out) but never more.
        "arsenal usage per pitcher season sums to at most 1",
        "select season, pitcher_id, sum(usage_pct) as total_usage from mart_pitcher_arsenal "
        "group by season, pitcher_id having sum(usage_pct) > 1.001 or count_if(usage_pct is null) > 0",
    ),
    Check(
        "release_spread_in is not null",
        "select season, pitcher_id from mart_release_consistency where release_spread_in is null",
    ),
    Check(
        # Tracked pitches outside 40-106 mph are almost always tracking errors.
        "velocity is in a plausible range",
        "select pitch_id, pitch_type, velo_mph from fct_pitches "
        "where velo_mph is not null and (velo_mph < 40 or velo_mph > 106)",
    ),
    Check(
        "every tracked game date in bronze reached silver",
        "select distinct try_cast(b.game_date as date) as game_date from bronze_pitches b "
        "where b.pitch_type is not null and trim(b.pitch_type) <> '' "
        "and try_cast(b.game_date as date) not in (select distinct game_date from fct_pitches)",
    ),
]


def run_checks(
    spark: SparkSession, tables: dict[str, DataFrame], sample_rows: int = 5
) -> list[str]:
    """Register `tables` as views (fct_pitches, bronze_pitches, dim_pitchers, marts...) and run every check.

    Returns one message per failed check, with a few offending rows.
    """
    for name, df in tables.items():
        df.createOrReplaceTempView(name)

    failures: list[str] = []
    for check in CHECKS:
        bad = spark.sql(check.sql)
        rows = bad.limit(sample_rows).collect()
        if rows:
            failures.append(f"FAILED: {check.name}: e.g. {[r.asDict() for r in rows]}")
        else:
            print(f"passed: {check.name}")
    return failures
