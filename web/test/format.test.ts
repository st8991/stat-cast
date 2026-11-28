import { describe, expect, it } from "vitest";
import { pgTimestampToIso } from "@/lib/db";
import { ago, displayName, fmt, niceTicks, ordinal, pct, pipelineStatus, ptClass, signed, sparkPath } from "@/lib/format";
import { defaultGameDate, shapeRuns } from "@/lib/queries";
import type { Health } from "@/lib/types";

describe("formatting", () => {
  it("formats numbers, percents and signs like the Python-era frontend", () => {
    expect(fmt(94.123)).toBe("94.1");
    expect(fmt(null)).toBe("–");
    expect(pct(0.4463, 1)).toBe("44.6%");
    expect(signed(1.234)).toBe("+1.2");
    expect(signed(-0.5)).toBe("−0.5");
    expect(signed(0)).toBe("±0.0");
    expect(ptClass("FF")).toBe("pt-FF");
    expect(ptClass("KN")).toBe("pt-XX");
  });

  it("flips 'Last, First' names and orders ordinals", () => {
    expect(displayName("Whitlock, Bram")).toBe("Bram Whitlock");
    expect(displayName("Ichiro")).toBe("Ichiro");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 93].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "93rd",
    ]);
  });

  it("describes elapsed time", () => {
    const now = Date.parse("2025-06-10T12:00:00Z");
    expect(ago("2025-06-10T11:59:30Z", now)).toBe("just now");
    expect(ago("2025-06-10T11:30:00Z", now)).toBe("30 min ago");
    expect(ago("2025-06-10T06:00:00Z", now)).toBe("6 h ago");
    expect(ago("2025-06-05T12:00:00Z", now)).toBe("5 days ago");
  });

  it("picks round tick steps and draws sparklines", () => {
    expect(niceTicks(-22, 22, 8)).toEqual([-20, -10, 0, 10, 20]);
    expect(niceTicks(90, 98, 4)).toEqual([90, 92, 94, 96, 98]);
    expect(sparkPath([94])).toBeNull();
    expect(sparkPath([94, 95])!.d.startsWith("M2.0,")).toBe(true);
  });
});

describe("timestamps from Postgres", () => {
  it("normalises timestamptz and timestamp text to ISO 8601", () => {
    expect(pgTimestampToIso("2025-06-03 14:00:00+00")).toBe("2025-06-03T14:00:00.000Z");
    expect(pgTimestampToIso("2025-06-03 09:00:00.5-05")).toBe("2025-06-03T14:00:00.500Z");
    expect(pgTimestampToIso("2025-06-03 19:30:00+05:30")).toBe("2025-06-03T14:00:00.000Z");
    expect(pgTimestampToIso("2025-06-03 14:00:00")).toBe("2025-06-03T14:00:00.000Z");
  });
});

describe("DAG runs", () => {
  it("mirrors the DAG's resolve_game_date", () => {
    // 9:00 AM Central on June 3 loads June 2.
    expect(defaultGameDate("2025-06-03T14:00:00+00:00")).toBe("2025-06-02");
    // 1:00 AM UTC on June 3 is still June 2 in Chicago, so the game date is June 1.
    expect(defaultGameDate("2025-06-03T01:00:00+00:00")).toBe("2025-06-01");
    expect(defaultGameDate(null)).toBeNull();
  });

  it("orders tasks, prefers the conf game date and computes durations", () => {
    const [run] = shapeRuns(
      [
        {
          run_id: "r1", run_type: "manual", state: "success", logical_date: "2025-06-03T14:00:00Z",
          run_after: null, start_date: "2025-06-03T14:00:00Z", end_date: "2025-06-03T14:00:09.3Z", conf_game_date: null,
        },
      ],
      [
        { run_id: "r1", task_id: "dbt_build", state: "success", try_number: 1, start_date: null, end_date: null },
        { run_id: "r1", task_id: "extract", state: "success", try_number: 1, start_date: null, end_date: null },
      ],
    );
    expect(run.tasks.map((t) => t.task_id)).toEqual(["extract", "dbt_build"]);
    expect(run.game_date).toBe("2025-06-02");
    expect(run.duration_s).toBe(9.3);
  });
});

describe("pipeline status", () => {
  const base: Health = {
    table_counts: [],
    freshness: { last_loaded_at: null, last_game_date: null, hours_since_load: 2, warn_after_hours: 36 },
    recent_loads: [],
    rows_by_date: [],
    airflow: { available: false, reason: "not set" },
    mode: "live",
  };
  const run = (state: string) => ({
    run_id: "r", run_type: "scheduled", state, logical_date: null, run_after: null,
    start_date: null, end_date: null, game_date: null, tasks: [],
  });

  it("reads the warehouse alone, then Airflow when it is connected", () => {
    expect(pipelineStatus(base).word).toBe("Warehouse only");
    expect(pipelineStatus({ ...base, freshness: { ...base.freshness, hours_since_load: 40 } }).level).toBe("warning");
    expect(pipelineStatus({ ...base, airflow: { available: true, dag_id: "d", runs: [run("failed")] } }).level).toBe("critical");
    expect(pipelineStatus({ ...base, airflow: { available: true, dag_id: "d", runs: [run("success")] } }).word).toBe("Healthy");
    expect(pipelineStatus({ ...base, airflow: { available: true, dag_id: "d", runs: [] } }).word).toBe("No runs yet");
  });
});
