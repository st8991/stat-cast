# statcast-pipeline

A daily batch pipeline for MLB pitch-tracking data. Every morning Airflow pulls the previous day's pitch-level Statcast data from Baseball Savant, lands the raw file, loads it into Postgres, and runs dbt to rebuild tested pitcher models: arsenal, movement vs league, release consistency, and game-by-game velocity trends.

It's the data engineering companion to [baseball-pitching-scout](https://github.com/st8991/baseball-pitching-scout), which studies one pitcher at a time from a local DuckDB file. This project is the shared, league-wide warehouse a tool like that would read from.

```mermaid
flowchart LR
    savant["Baseball Savant<br/>statcast_search/csv"]
    subgraph airflow["Airflow DAG: statcast_daily (9:00 AM CT)"]
        direction LR
        r[resolve_game_date] --> e[extract]
        e --> s{has_pitches?}
        s -- "off day" --> skip((skip))
        s -- yes --> l[load]
        l --> d[dbt_build]
    end
    savant --> e
    e --> landing[("landing zone<br/>game_date=YYYY-MM-DD/<br/>statcast.csv.gz")]
    landing --> l
    l --> raw[("Postgres<br/>raw.statcast_pitches")]
    d --> stg["staging.stg_statcast__pitches<br/>(view)"]
    stg --> fct["marts.fct_pitches<br/>(incremental)"]
    fct --> dim[marts.dim_pitchers]
    fct --> m1[marts.mart_pitcher_arsenal]
    fct --> m2[marts.mart_pitch_movement]
    fct --> m3[marts.mart_release_consistency]
    fct --> m4[marts.mart_pitcher_game_trends]
```

## Quick start

You need Docker. The stack runs offline by default on a synthetic sample week, so nothing depends on Savant being reachable.

```bash
docker compose up -d --build     # Postgres + Airflow 3, http://localhost:8080
make backfill                    # run the DAG once per day of the sample week
make psql                        # then query the marts
```

```sql
select pitcher_name, pitch_type, usage_pct, avg_velo_mph, avg_ivb_in, whiff_pct, csw_pct
from marts.mart_pitcher_arsenal
order by pitcher_name, usage_pct desc;
```

To pull real data, set `STATCAST_SOURCE=savant` in `.env` (copy `.env.example`), restart, and unpause `statcast_daily` in the UI, or backfill a range:

```bash
docker compose exec airflow airflow backfill create --dag-id statcast_daily \
    --from-date 2025-04-01 --to-date 2025-04-07
```

Each run loads the game date before its logical date. To load one specific day, trigger the DAG with `{"game_date": "2025-06-01"}`.

### Without Docker

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export WAREHOUSE_HOST=localhost WAREHOUSE_PORT=5432          # any Postgres you can reach
PYTHONPATH=src python -m statcast_pipeline --source sample backfill --start 2025-06-02 --end 2025-06-09
DBT_PROFILES_DIR=dbt dbt build --project-dir dbt
pytest -q
```

## How it works

### Ingest (`src/statcast_pipeline/`)

| Step | What it does |
|---|---|
| `extract.py` | One request per game date to Savant's CSV endpoint (regular season). Retries 429/5xx with exponential backoff. Savant caps a query at 25,000 rows; a full day is about 4,500 pitches, so hitting the cap means a truncated result and the task fails instead of loading a partial day. Writes `landing/game_date=YYYY-MM-DD/statcast.csv.gz` atomically. |
| `transform.py` | Conforms the frame to a fixed 45-column contract (`schema.py`). Savant's CSV has 100+ columns and keeps adding more (`arm_angle` arrived in 2024): unknown columns are dropped and logged, missing ones become NULL, numbers that won't parse become NULL, rows without a full key are dropped, repeated pitches keep the last version. |
| `load.py` | Replaces whole game dates in one transaction: `delete` the dates in the batch, then `COPY` the new rows, then write an audit row to `raw.ingestion_log`. Re-running a day or a range never double counts, and a failed load leaves the previous version in place. |

The full original CSV stays in the landing zone, so adding a column to the contract later is a reload from disk, not a re-download.

### Orchestrate (`dags/statcast_daily.py`)

Airflow 3 TaskFlow DAG. `has_pitches` short-circuits on off days so load and dbt are skipped, not failed. Tasks retry with exponential backoff, `max_active_runs=3` keeps backfills polite to Savant, and dbt runs from its own virtualenv in the image because its dependency pins conflict with Airflow's.

### Model (`dbt/`)

| Model | Grain | What's in it |
|---|---|---|
| `stg_statcast__pitches` | pitch | Renamed columns; movement in inches; **arm-side break** (horizontal break flipped for lefties, so positive always means arm-side run); outcome flags (`is_swing`, `is_whiff`, `is_csw`, `is_chase`, `is_in_zone`); run value from the pitcher's side. |
| `fct_pitches` | pitch | Incremental (`delete+insert` on `pitch_id`). Each run re-processes the last 3 game dates, because Savant revises pitch types and run values after the fact. |
| `dim_pitchers` | pitcher | Latest name, hand and team, first/last game, workload. |
| `mart_pitcher_arsenal` | season × pitcher × pitch type | Usage, velo, spin, IVB, arm-side break, extension, whiff%, CSW%, zone%, chase%, xwOBA on contact, run value per 100. |
| `mart_pitch_movement` | season × pitcher × pitch type | Velo and movement minus the league average for the same pitch type, hand and season, plus z-scores ("this four-seamer has +4 in of ride"). |
| `mart_release_consistency` | season × pitcher | Release point spread in inches, extension and arm-angle variability, and **tunneling**: distance between each secondary pitch's release centroid and the primary pitch's. |
| `mart_pitcher_game_trends` | pitcher × game | Fastball velo and release height against the pitcher's own prior-game baseline, with a flag for a 1.5+ mph drop after 3+ games. The morning-after view a performance staff would check. |

Tests: `unique`/`not_null`/`accepted_values`/`relationships` on keys, a **dbt unit test** that pins the arm-side sign convention and the swing/whiff/CSW/chase flags, and singular tests for implausible velocities, arsenal grain, usage summing past 100%, and every landed day reaching the fact table. Source freshness warns if no new pitches land for 36 hours (expected to warn in the off-season).

### Tests and CI

`pytest` covers the transform contract, retry and truncation logic, off-day handling, load idempotency against a real Postgres (each test runs in a throwaway schema; skipped when no database is reachable), and DAG integrity (no import errors, expected task graph, retries on every task). GitHub Actions runs ruff, pytest, the sample backfill and `dbt build` twice (full, then incremental) against a Postgres service, plus the DAG checks in a separate Airflow job.

## The sample data is synthetic

`data/sample/statcast_sample.csv.gz` is generated by `scripts/make_sample.py` (deterministic, byte-identical on every run). It has Statcast's column names and plausible distributions for 16 fictional pitchers on two fictional teams over one week, including an off day, a repeated row and Savant's stray `pitcher.1` column so the loader's edge cases get exercised. **Its numbers describe no real player.** Real analysis needs `STATCAST_SOURCE=savant`.

## Layout

```
dags/statcast_daily.py           Airflow DAG
src/statcast_pipeline/           extract, transform, load, CLI
dbt/models/staging/              source definition, staging view, unit test
dbt/models/marts/                fact, dimension and pitcher marts
dbt/tests/                       singular data tests
dbt/analyses/                    example queries
scripts/make_sample.py           synthetic sample generator
tests/                           pytest suites
docker-compose.yml, Dockerfile   local Postgres + Airflow 3 stack
.github/workflows/ci.yml         lint, tests, dbt build, DAG checks
```

## Known limits and next steps

- **Savant rate limits.** One request per day per run is gentle, but a full-season backfill is ~190 requests; keep `max_active_runs` low.
- **Regular season only.** Postseason and spring training are a parameter change in `extract.GAME_TYPES`.
- **Statcast data belongs to MLB.** Use it for personal research; don't redistribute pulled data.
- Natural next steps: partition `raw.statcast_pitches` by season, add batter-side marts (swing decisions, bat tracking), publish dbt docs, and point PitchScout's data layer at this warehouse.
