// Read-only queries behind the dashboard.
//
// Everything comes from the dbt marts (plus a sample of fct_pitches for the
// per-pitch scatter plots), the loader's audit table, and, if it is reachable,
// Airflow's own metadata database for the latest DAG runs.

import type postgres from "postgres";
import type {
  AirflowRuns,
  ArsenalRow,
  DagRun,
  GameTrend,
  Health,
  LeaderRow,
  LeagueShape,
  Overview,
  PitchPoint,
  PitcherDetail,
  Profile,
  Release,
  RosterPitcher,
  TaskInstance,
  Totals,
  VeloAlert,
} from "./types";

type Sql = postgres.Sql<Record<string, never>>;

export const DAG_ID = "statcast_daily";
export const DAG_TZ = "America/Chicago";
/** Per-pitch points drawn on the movement and release plots for one pitcher. */
export const MAX_PITCH_POINTS = 1500;
/** Same threshold as the dbt source freshness check (warn_after: 36 hours). */
export const WARN_AFTER_HOURS = 36;

export const MART_TABLES = [
  "raw.statcast_pitches",
  "marts.fct_pitches",
  "marts.dim_pitchers",
  "marts.mart_pitcher_arsenal",
  "marts.mart_pitch_movement",
  "marts.mart_release_consistency",
  "marts.mart_pitcher_game_trends",
] as const;

const TASK_ORDER: Record<string, number> = { resolve_game_date: 0, extract: 1, has_pitches: 2, load: 3, dbt_build: 4 };

const rows = <T>(r: readonly unknown[]): T[] => [...r] as T[];

export async function seasons(sql: Sql): Promise<number[]> {
  const r = await sql`select distinct season from marts.fct_pitches order by season desc`;
  return r.map((x) => Number(x.season));
}

/** Everything the dashboard needs before a pitcher is picked. */
export async function overview(sql: Sql, requested?: number | null): Promise<Overview> {
  const allSeasons = await seasons(sql);
  const season = requested ?? allSeasons[0] ?? null;

  const [pitchers, velo, ride, whiff, consistency, leagueShape, alerts, totals] = await Promise.all([
    sql`
      with season_pitches as (
          select pitcher_id, count(*) as pitches, count(distinct game_pk) as games, max(game_date) as last_game_date
          from marts.fct_pitches where season = ${season} group by pitcher_id
      ),
      primary_type as (
          select distinct on (pitcher_id) pitcher_id, pitch_type as primary_pitch_type
          from marts.mart_pitcher_arsenal where season = ${season}
          order by pitcher_id, usage_pct desc, pitch_type
      ),
      latest_game as (
          select distinct on (pitcher_id) pitcher_id, fb_velo_mph, velo_vs_baseline_mph, velo_drop_flag
          from marts.mart_pitcher_game_trends where season = ${season}
          order by pitcher_id, game_date desc, game_pk desc
      ),
      any_flag as (
          select pitcher_id, bool_or(velo_drop_flag) as any_velo_drop
          from marts.mart_pitcher_game_trends where season = ${season} group by pitcher_id
      ),
      spark as (
          select pitcher_id, json_agg(fb_velo_mph order by game_date, game_pk) as fb_velo_by_game
          from marts.mart_pitcher_game_trends where season = ${season} group by pitcher_id
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
    `,
    sql`
      select pitcher_id, pitcher_name, pitch_type, avg_velo_mph as value
      from marts.mart_pitcher_arsenal
      where season = ${season} and pitch_type in ('FF', 'SI', 'FC')
      order by avg_velo_mph desc nulls last limit 5
    `,
    sql`
      select pitcher_id, pitcher_name, pitch_type, ivb_vs_league_in as value
      from marts.mart_pitch_movement
      where season = ${season} and pitch_type = 'FF'
      order by ivb_vs_league_in desc nulls last limit 5
    `,
    sql`
      select pitcher_id, pitcher_name, pitch_type, whiff_pct as value
      from marts.mart_pitcher_arsenal
      where season = ${season} and whiff_pct is not null
      order by whiff_pct desc limit 5
    `,
    sql`
      select pitcher_id, pitcher_name, primary_pitch_type as pitch_type, release_spread_in as value
      from marts.mart_release_consistency
      where season = ${season}
      order by release_spread_in asc nulls last limit 5
    `,
    sql`
      select pitch_type, max(pitch_name) as pitch_name, count(*) as pitches,
             round(avg(velo_mph)::numeric, 1) as velo_mph,
             round(avg(induced_vert_break_in)::numeric, 1) as ivb_in,
             round(avg(arm_side_break_in)::numeric, 1) as arm_side_break_in
      from marts.fct_pitches where season = ${season}
      group by pitch_type order by count(*) desc
    `,
    sql`
      select pitcher_id, pitcher_name, game_date, fb_velo_mph, velo_vs_baseline_mph
      from marts.mart_pitcher_game_trends
      where season = ${season} and velo_drop_flag
      order by game_date desc, velo_vs_baseline_mph
    `,
    sql`
      select count(*) as pitches, count(distinct pitcher_id) as pitchers, count(distinct game_pk) as games,
             min(game_date) as first_game_date, max(game_date) as last_game_date
      from marts.fct_pitches where season = ${season}
    `,
  ]);

  return {
    season,
    seasons: allSeasons,
    totals: rows<Totals>(totals)[0],
    pitchers: rows<RosterPitcher>(pitchers),
    leaders: {
      velo: rows<LeaderRow>(velo),
      ride: rows<LeaderRow>(ride),
      whiff: rows<LeaderRow>(whiff),
      consistency: rows<LeaderRow>(consistency),
    },
    league_shape: rows<LeagueShape>(leagueShape),
    alerts: rows<VeloAlert>(alerts),
  };
}

/** One pitcher's arsenal, movement vs league, release, game trends and a sample of pitches. */
export async function pitcher(sql: Sql, pitcherId: number, requested?: number | null): Promise<PitcherDetail | null> {
  const profile = rows<Profile>(await sql`select * from marts.dim_pitchers where pitcher_id = ${pitcherId}`);
  if (!profile.length) return null;
  let season = requested ?? null;
  if (season == null) {
    const [found] = await sql`select max(season) as season from marts.fct_pitches where pitcher_id = ${pitcherId}`;
    season = found?.season == null ? null : Number(found.season);
  }

  const [arsenal, release, trends, pitches, leagueRelease] = await Promise.all([
    sql`
      select a.*, m.velo_vs_league_mph, m.ivb_vs_league_in, m.arm_side_vs_league_in, m.ivb_z, m.arm_side_z
      from marts.mart_pitcher_arsenal a
      left join marts.mart_pitch_movement m using (season, pitcher_id, pitch_type)
      where a.pitcher_id = ${pitcherId} and a.season = ${season}
      order by a.usage_pct desc, a.pitch_type
    `,
    sql`select * from marts.mart_release_consistency where pitcher_id = ${pitcherId} and season = ${season}`,
    sql`
      select game_pk, game_date, fastballs, fb_velo_mph, fb_max_velo_mph, release_z_ft, extension_ft,
             prior_games, velo_vs_baseline_mph, release_z_vs_baseline_in, velo_drop_flag
      from marts.mart_pitcher_game_trends
      where pitcher_id = ${pitcherId} and season = ${season}
      order by game_date, game_pk
    `,
    sql`
      select pitch_type, velo_mph, induced_vert_break_in as ivb_in, arm_side_break_in,
             release_x_ft, release_z_ft, plate_x_ft, plate_z_ft, is_whiff, is_csw
      from marts.fct_pitches
      where pitcher_id = ${pitcherId} and season = ${season}
        and induced_vert_break_in is not null and arm_side_break_in is not null
      order by md5(pitch_id)  -- stable pseudo-random sample
      limit ${MAX_PITCH_POINTS}
    `,
    // Release cloud of the whole league, so this pitcher's spread has context.
    sql`
      select round(avg(release_spread_in)::numeric, 2) as avg_release_spread_in,
             round(avg(max_tunnel_gap_in)::numeric, 2) as avg_max_tunnel_gap_in
      from marts.mart_release_consistency where season = ${season}
    `,
  ]);

  return {
    season: season as number,
    profile: profile[0],
    arsenal: rows<ArsenalRow>(arsenal),
    release: (release[0] as Release | undefined) ?? null,
    league_release: (leagueRelease[0] as PitcherDetail["league_release"]) ?? null,
    trends: rows<GameTrend>(trends),
    pitches: rows<PitchPoint>(pitches),
  };
}

export async function warehouseHealth(sql: Sql): Promise<Omit<Health, "airflow" | "mode">> {
  const counts = await Promise.all(
    MART_TABLES.map(async (table) => {
      try {
        // Table names are the constants above, quoted as identifiers.
        const [r] = await sql`select count(*) as rows from ${sql(table)}`;
        return { table, rows: Number(r.rows) };
      } catch {
        return { table, rows: null };
      }
    }),
  );

  const [[freshness], loads, byDate] = await Promise.all([
    sql`
      select max(_loaded_at) as last_loaded_at, max(game_date) as last_game_date,
             extract(epoch from now() - max(_loaded_at)) / 3600.0 as hours_since_load
      from raw.statcast_pitches
    `,
    sql`
      select game_date, row_count, source, loaded_at
      from raw.ingestion_log
      order by loaded_at desc, game_date desc
      limit 30
    `,
    sql`
      select game_date, count(*) as pitches, count(distinct game_pk) as games
      from raw.statcast_pitches
      group by game_date order by game_date desc limit 21
    `,
  ]);

  const hours = freshness.hours_since_load == null ? null : Math.round(Number(freshness.hours_since_load) * 10) / 10;
  return {
    table_counts: counts,
    freshness: {
      last_loaded_at: freshness.last_loaded_at ?? null,
      last_game_date: freshness.last_game_date ?? null,
      hours_since_load: hours,
      warn_after_hours: WARN_AFTER_HOURS,
    },
    recent_loads: rows<Health["recent_loads"][number]>(loads),
    rows_by_date: rows<Health["rows_by_date"][number]>(byDate).reverse(),
  };
}

/** Latest runs of the DAG and their task states, read from Airflow's metadata DB. */
export async function airflowRuns(sql: Sql, limit = 14): Promise<AirflowRuns> {
  const runs = rows<DagRun & { conf_game_date: string | null }>(
    await sql`
      select run_id, run_type, state, logical_date, run_after, start_date, end_date,
             conf ->> 'game_date' as conf_game_date
      from dag_run where dag_id = ${DAG_ID}
      order by coalesce(start_date, run_after) desc nulls last
      limit ${limit}
    `,
  );
  const ids = runs.map((r) => r.run_id);
  const tasks = ids.length
    ? rows<TaskInstance & { run_id: string }>(
        await sql`
          select run_id, task_id, state, try_number, start_date, end_date
          from task_instance where dag_id = ${DAG_ID} and run_id in ${sql(ids)}
        `,
      )
    : [];
  return { available: true, dag_id: DAG_ID, runs: shapeRuns(runs, tasks) };
}

/** Attach each run's tasks (in DAG order), its game date and its duration. */
export function shapeRuns(
  runs: (Omit<DagRun, "tasks" | "game_date"> & { conf_game_date: string | null })[],
  tasks: (TaskInstance & { run_id: string })[],
): DagRun[] {
  const byRun = new Map<string, TaskInstance[]>();
  for (const { run_id, ...t } of tasks) {
    if (!byRun.has(run_id)) byRun.set(run_id, []);
    byRun.get(run_id)!.push(t);
  }
  return runs.map(({ conf_game_date, ...r }) => {
    const out: DagRun = {
      ...r,
      tasks: (byRun.get(r.run_id) ?? []).sort((a, b) => (TASK_ORDER[a.task_id] ?? 99) - (TASK_ORDER[b.task_id] ?? 99)),
      game_date: conf_game_date || defaultGameDate(r.logical_date ?? r.run_after),
    };
    if (r.start_date && r.end_date) {
      out.duration_s = Math.round((Date.parse(r.end_date) - Date.parse(r.start_date)) / 100) / 10;
    }
    return out;
  });
}

/** Mirror the DAG's resolve_game_date: the day before the run, in the DAG's time zone. */
export function defaultGameDate(runAt: string | null | undefined): string | null {
  if (!runAt) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAG_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(runAt));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}
