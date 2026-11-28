// Formatting and small scale helpers for the dashboard UI. Pure functions, unit tested.

import type { Health } from "./types";

export const PITCH_TYPES = ["FF", "SI", "FC", "SL", "ST", "CU", "CH", "FS"] as const;
export const PITCH_NAMES: Record<string, string> = {
  FF: "4-Seam",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  CU: "Curveball",
  CH: "Changeup",
  FS: "Splitter",
};
export const TASKS = ["resolve_game_date", "extract", "has_pitches", "load", "dbt_build"] as const;
export const TASK_LABEL: Record<string, string> = {
  resolve_game_date: "resolve",
  extract: "extract",
  has_pitches: "has pitches",
  load: "load",
  dbt_build: "dbt build",
};

type MaybeNum = number | null | undefined;

export const ptClass = (t: string | null | undefined) =>
  `pt-${t && (PITCH_TYPES as readonly string[]).includes(t) ? t : "XX"}`;

export const fmt = (v: MaybeNum, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));

export const pct = (v: MaybeNum, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);

export const signed = (v: MaybeNum, d = 1) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`;

/** "Ohtani, Shohei" → "Shohei Ohtani". */
export const displayName = (n: string | null | undefined) => {
  if (!n) return "";
  const [last, first] = n.split(",").map((s) => s.trim());
  return first ? `${first} ${last}` : n;
};

export const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "–";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "–";
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export const ordinal = (n: number) => {
  const suffix = ["th", "st", "nd", "rd"];
  return `${n}${suffix[((n % 100) - 20) % 10] || suffix[n % 100] || "th"}`;
};

export const scale =
  (d0: number, d1: number, r0: number, r1: number) =>
  (v: number) =>
    r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const step0 = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export type Level = "good" | "warning" | "critical" | "neutral";

/** The one-word pipeline status in the top bar. */
export function pipelineStatus(h: Health): { level: Level; word: string } {
  const af = h.airflow;
  const latest = af.available ? af.runs[0] : undefined;
  const fresh = h.freshness;
  const stale = fresh.hours_since_load != null && fresh.hours_since_load > fresh.warn_after_hours;
  if (latest?.state === "failed") return { level: "critical", word: "Last run failed" };
  if (latest && ["running", "queued"].includes(latest.state ?? "")) return { level: "good", word: "Running now" };
  if (h.mode === "snapshot") return { level: "neutral", word: "Snapshot" };
  if (stale) return { level: "warning", word: "Data is stale" };
  if (latest?.state === "success") return { level: "good", word: "Healthy" };
  return { level: "neutral", word: af.available ? "No runs yet" : "Warehouse only" };
}

/** SVG path for a roster sparkline in a w × h box, or null with fewer than two points. */
export function sparkPath(values: number[], w = 64, h = 22) {
  if (!values || values.length < 2) return null;
  const lo = Math.min(...values) - 0.3;
  const hi = Math.max(...values) + 0.3;
  const x = scale(0, values.length - 1, 2, w - 3);
  const y = scale(lo, hi, h - 3, 3);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return { d, end: { cx: x(last), cy: y(values[last]) } };
}
