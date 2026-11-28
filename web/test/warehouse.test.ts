// Against a real warehouse: runs when WAREHOUSE_* / DATABASE_URL reach a Postgres
// with the marts built (CI does the sample backfill and dbt build first), skips otherwise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataError, warehouseUrlFromEnv, withWarehouse } from "@/lib/db";
import { MAX_PITCH_POINTS, overview, pitcher, warehouseHealth } from "@/lib/queries";
import { GET as getHealth } from "@/app/api/health.json/route";
import { GET as getPitcher } from "@/app/api/pitcher/[file]/route";

let ready = false;
beforeAll(async () => {
  try {
    ready = await withWarehouse(async (sql) => {
      const [r] = await sql`select to_regclass('marts.mart_pitcher_game_trends') as t, to_regclass('raw.ingestion_log') as l`;
      return r.t != null && r.l != null;
    });
  } catch {
    ready = false;
  }
});

describe("warehouse queries", () => {
  it("builds the overview, a pitcher and health from the marts", async (ctx) => {
    if (!ready) ctx.skip();
    const ov = await withWarehouse((sql) => overview(sql));
    expect(ov.seasons).toContain(ov.season);
    expect(ov.totals.pitches).toBeGreaterThan(0);
    expect(typeof ov.totals.pitches).toBe("number");
    expect(Object.keys(ov.leaders).sort()).toEqual(["consistency", "ride", "velo", "whiff"]);
    expect(Array.isArray(ov.pitchers[0].fb_velo_by_game)).toBe(true);
    expect(ov.totals.last_game_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const pid = ov.pitchers[0].pitcher_id;
    const p = await withWarehouse((sql) => pitcher(sql, pid));
    expect(p!.profile.pitcher_id).toBe(pid);
    expect(p!.arsenal.length && p!.pitches.length).toBeTruthy();
    expect(p!.arsenal.reduce((s, a) => s + a.usage_pct, 0)).toBeLessThanOrEqual(1.0001);
    expect(p!.pitches.length).toBeLessThanOrEqual(MAX_PITCH_POINTS);
    expect(await withWarehouse((sql) => pitcher(sql, 1))).toBeNull();

    const h = await withWarehouse(warehouseHealth);
    const counts = Object.fromEntries(h.table_counts.map((t) => [t.table, t.rows]));
    expect(counts["raw.statcast_pitches"]).toBeGreaterThan(0);
    expect(counts["marts.fct_pitches"]).toBeGreaterThan(0);
    expect(h.freshness.last_game_date).toBeTruthy();
    expect(h.recent_loads.length && h.rows_by_date.length).toBeTruthy();
  });

  it("serves the API routes", async (ctx) => {
    if (!ready) ctx.skip();
    const health = await (await getHealth()).json();
    expect(health.mode).toBe("live");
    expect("available" in health.airflow).toBe(true);
    const missing = await getPitcher(new Request("http://x/api/pitcher/1.json"), { params: Promise.resolve({ file: "1.json" }) });
    expect(missing.status).toBe(404);
    const bad = await getPitcher(new Request("http://x/api/pitcher/abc"), { params: Promise.resolve({ file: "abc" }) });
    expect(bad.status).toBe(404);
  });
});

describe("unreachable warehouse", () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL = "postgres://nobody:x@127.0.0.1:1/none";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it("maps a refused connection to a 503", async () => {
    expect(warehouseUrlFromEnv()).toContain(":1/none");
    const err = await withWarehouse((sql) => sql`select 1`).catch((e) => e);
    expect(err).toBeInstanceOf(DataError);
    expect(err.status).toBe(503);
    const res = await getHealth();
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toMatch(/warehouse unreachable/);
  });
});
