"use client";

import type { KeyboardEvent, ReactNode } from "react";
import {
  ago,
  displayName,
  fmt,
  ordinal,
  PITCH_NAMES,
  pct,
  pipelineStatus,
  ptClass,
  shortDate,
  signed,
  TASK_LABEL,
  TASKS,
  type Level,
} from "@/lib/format";
import type { ArsenalRow, Board, Health, Overview, PitcherDetail, RosterPitcher } from "@/lib/types";
import { RowsChart, Sparkline } from "./charts";
import { Chip, Icon, TipRow, useTip } from "./ui";

/* ---------- top bar ticker ---------- */
export function Ticker({ overview, error }: { overview: Overview | null; error: string | null }) {
  if (error) return <div className="ticker">Run the DAG (or make backfill) to build the marts, then reload.</div>;
  if (!overview) {
    return (
      <div className="ticker">
        <span className="skeleton w-280"></span>
      </div>
    );
  }
  const t = overview.totals;
  const parts: ReactNode[] = [
    <>
      Season <b>{overview.season}</b>
    </>,
    <>
      Data through <b>{shortDate(t.last_game_date)}</b>
    </>,
    <>
      <b>{Number(t.pitches).toLocaleString()}</b> pitches
    </>,
    <>
      <b>{t.pitchers}</b> pitchers
    </>,
    <>
      <b>{t.games}</b> games
    </>,
  ];
  return (
    <div className="ticker">
      {parts.map((p, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span className="sep"></span>}
          {p}
        </span>
      ))}
    </div>
  );
}

/* ---------- roster ---------- */
export type HandFilter = "" | "R" | "L" | "flag";

export function Roster({
  pitchers,
  selected,
  hand,
  query,
  onHand,
  onQuery,
  onSelect,
}: {
  pitchers: RosterPitcher[];
  selected: number | null;
  hand: HandFilter;
  query: string;
  onHand: (h: HandFilter) => void;
  onQuery: (q: string) => void;
  onSelect: (id: number) => void;
}) {
  const q = query.toLowerCase();
  const list = pitchers.filter((p) => {
    if (hand === "flag" && !p.any_velo_drop) return false;
    if (hand && hand !== "flag" && p.pitcher_hand !== hand) return false;
    return !q || `${p.pitcher_name} ${displayName(p.pitcher_name)} ${p.latest_team}`.toLowerCase().includes(q);
  });

  const onKey = (e: KeyboardEvent<HTMLLIElement>, id: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as
        | HTMLLIElement
        | null;
      if (next?.dataset.id) {
        next.focus();
        onSelect(Number(next.dataset.id));
      }
    }
  };

  const hands: { h: HandFilter; label: ReactNode; title?: string }[] = [
    { h: "", label: "All" },
    { h: "R", label: "RHP" },
    { h: "L", label: "LHP" },
    {
      h: "flag",
      title: "Pitchers with a fastball velo drop",
      label: (
        <>
          <svg viewBox="0 0 24 24" className="flag-ico" aria-hidden="true">
            <path d="M12 3 2 21h20L12 3z" />
            <path d="M12 10v5M12 18v.5" />
          </svg>
          Flags
        </>
      ),
    },
  ];

  return (
    <aside className="panel glass roster">
      <div className="panel-head">
        <h2>Pitchers</h2>
        <span className="muted small">{pitchers.length ? `${list.length} of ${pitchers.length}` : ""}</span>
      </div>
      <label className="search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          type="search"
          placeholder="Search name or team"
          autoComplete="off"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      <div className="seg" role="group" aria-label="Filter by hand">
        {hands.map((b) => (
          <button key={b.h} type="button" aria-pressed={hand === b.h} title={b.title} onClick={() => onHand(b.h)}>
            {b.label}
          </button>
        ))}
      </div>
      <ul className="roster-list" role="listbox" aria-label="Pitchers">
        {list.length ? (
          list.map((p) => (
            <li
              key={p.pitcher_id}
              role="option"
              tabIndex={0}
              data-id={p.pitcher_id}
              aria-selected={p.pitcher_id === selected}
              onClick={() => onSelect(p.pitcher_id)}
              onKeyDown={(e) => onKey(e, p.pitcher_id)}
            >
              <span className="r-name">
                {displayName(p.pitcher_name)}
                {p.any_velo_drop && (
                  <span className="flag" title="Fastball velo drop flagged">
                    {Icon.flag}
                  </span>
                )}
              </span>
              <span className="r-meta">
                {p.pitcher_hand}HP · {p.latest_team} · {p.pitches} P {p.primary_pitch_type && <Chip type={p.primary_pitch_type} />}
              </span>
              <span className="r-spark">
                <Sparkline values={p.fb_velo_by_game} flagged={p.last_game_velo_drop} />
                <span className="v">{fmt(p.last_fb_velo_mph)}</span>
              </span>
            </li>
          ))
        ) : pitchers.length ? (
          <li className="muted small" style={{ cursor: "default" }}>
            No pitchers match.
          </li>
        ) : null}
      </ul>
    </aside>
  );
}

/* ---------- hero + KPIs ---------- */
export function Hero({ detail, error }: { detail: PitcherDetail | null; error: string | null }) {
  if (!detail) {
    return (
      <div className="panel glass hero">
        <div className="hero-id">
          <div className="hero-kicker">{error ?? " "}</div>
          <h1>{error ? "No data yet" : <span className="skeleton w-200"></span>}</h1>
          <div className="hero-mix"></div>
        </div>
        <div className="kpis"></div>
      </div>
    );
  }
  const p = detail.profile;
  const ars = detail.arsenal;
  const total = ars.reduce((s, a) => s + a.pitches, 0) || 1;
  const wavg = (k: keyof ArsenalRow) => ars.reduce((s, a) => s + (Number(a[k]) || 0) * a.pitches, 0) / total;
  const fb = ars.find((a) => ["FF", "SI", "FC"].includes(a.pitch_type));
  const bestWhiff = ars.filter((a) => a.whiff_pct != null).sort((a, b) => b.whiff_pct! - a.whiff_pct!)[0];
  const rel = detail.release;
  const csw = wavg("csw_pct");
  const rv = wavg("run_value_per_100");
  const upDown = (v: number | null | undefined) => ((v ?? 0) >= 0 ? "up" : "down");

  const tiles: { k: string; v: ReactNode; d: ReactNode }[] = [
    fb
      ? {
          k: `${PITCH_NAMES[fb.pitch_type] || fb.pitch_type} velo`,
          v: (
            <>
              {fmt(fb.avg_velo_mph)}
              <small>mph</small>
            </>
          ),
          d: (
            <>
              <span className={upDown(fb.velo_vs_league_mph)}>{signed(fb.velo_vs_league_mph)}</span> vs league avg
            </>
          ),
        }
      : { k: "Fastball velo", v: "–", d: "no fastball" },
    { k: "CSW%", v: pct(csw, 1), d: bestWhiff ? `best whiff ${bestWhiff.pitch_type} ${pct(bestWhiff.whiff_pct)}` : "" },
    {
      k: "Run value / 100",
      v: signed(rv, 2),
      d: <span className={upDown(rv)}>{rv >= 0 ? "▲ saves runs" : "▼ costs runs"}</span>,
    },
    rel
      ? {
          k: "Release spread",
          v: (
            <>
              {fmt(rel.release_spread_in, 1)}
              <small>in</small>
            </>
          ),
          d: `${ordinal(Math.round((rel.consistency_pctile ?? 0) * 100))} pctile`,
        }
      : { k: "Release spread", v: "–", d: "" },
  ];

  return (
    <div className="panel glass hero">
      <div className="hero-id">
        <div className="hero-kicker">
          {p.pitcher_hand === "L" ? "Left" : "Right"}-handed · {p.latest_team} · {p.games} G · {p.pitches.toLocaleString()} pitches ·{" "}
          {shortDate(p.first_game_date)} – {shortDate(p.last_game_date)}
        </div>
        <h1>{displayName(p.pitcher_name)}</h1>
        <div className="hero-mix">
          {ars.map((a) => (
            <span key={a.pitch_type} className={ptClass(a.pitch_type)} style={{ flex: a.usage_pct }} title={`${a.pitch_type} ${pct(a.usage_pct)}`}></span>
          ))}
        </div>
      </div>
      <div className="kpis">
        {tiles.map((t) => (
          <div className="kpi" key={t.k}>
            <div className="k">{t.k}</div>
            <div className="v">{t.v}</div>
            <div className="d">{t.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- arsenal table ---------- */
function Vs({ v, unit = "", good = 1 }: { v: number | null; unit?: string; good?: number }) {
  if (v == null) return null;
  const cls = v * good > 0.05 ? "up" : v * good < -0.05 ? "down" : "muted";
  return (
    <span className={`vs ${cls}`}>
      {signed(v)}
      {unit}
    </span>
  );
}

export function ArsenalTable({
  arsenal,
  hoverType,
  onHover,
}: {
  arsenal: ArsenalRow[];
  hoverType: string | null;
  onHover: (t: string | null) => void;
}) {
  const heads = ["Pitch", "Usage", "Velo", "Spin", "IVB", "Arm-side", "Ext", "Whiff%", "CSW%", "Zone%", "Chase%", "xwOBAcon", "RV/100"];
  return (
    <table id="arsenal-table">
      <thead>
        <tr>
          {heads.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {arsenal.map((a) => (
          <tr
            key={a.pitch_type}
            data-type={a.pitch_type}
            className={hoverType === a.pitch_type ? "hl" : undefined}
            onMouseEnter={() => onHover(a.pitch_type)}
            onMouseLeave={() => onHover(null)}
          >
            <td>
              <Chip type={a.pitch_type} />
              <span className="name">{a.pitch_name}</span>
            </td>
            <td>
              <div className="usage">
                <span>{pct(a.usage_pct, 1)}</span>
                <span className="track">
                  <span className={`fill ${ptClass(a.pitch_type)}`} style={{ width: `${(a.usage_pct * 100).toFixed(1)}%` }}></span>
                </span>
              </div>
            </td>
            <td className="num-strong">
              {fmt(a.avg_velo_mph)}
              <Vs v={a.velo_vs_league_mph} />
            </td>
            <td>{fmt(a.avg_spin_rpm, 0)}</td>
            <td className="num-strong">
              {fmt(a.avg_ivb_in)}
              <Vs v={a.ivb_vs_league_in} good={0} />
            </td>
            <td className="num-strong">
              {fmt(a.avg_arm_side_break_in)}
              <Vs v={a.arm_side_vs_league_in} good={0} />
            </td>
            <td>{fmt(a.avg_extension_ft, 1)}</td>
            <td>{pct(a.whiff_pct, 1)}</td>
            <td>{pct(a.csw_pct, 1)}</td>
            <td>{pct(a.zone_pct, 0)}</td>
            <td>{pct(a.chase_pct, 0)}</td>
            <td>{fmt(a.xwoba_on_contact, 3).replace(/^0/, "")}</td>
            <td className={`num-strong ${(a.run_value_per_100 ?? 0) >= 0 ? "up" : "down"}`}>{signed(a.run_value_per_100, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- pipeline ---------- */
const ICON_FOR: Record<Level, ReactNode> = { good: Icon.check, warning: Icon.clock, critical: Icon.x, neutral: Icon.dash };

export function PipelinePill({ health, error, onClick }: { health: Health | null; error: string | null; onClick: () => void }) {
  const st = error
    ? { level: "critical" as Level, word: "Warehouse unreachable" }
    : health
      ? pipelineStatus(health)
      : null;
  return (
    <button className="pipeline-pill" type="button" aria-label="Pipeline status" data-state={st?.level} onClick={onClick}>
      <span className="dot"></span>
      <span className="label">{st ? st.word : "Checking pipeline…"}</span>
    </button>
  );
}

export function Pipeline({ health, error }: { health: Health | null; error: string | null }) {
  const tip = useTip();
  if (error) {
    return (
      <PipelineShell>
        <div className="run-summary">
          <span className="status-badge critical">{Icon.x}error</span>
          <div className="run-meta">{error}</div>
        </div>
      </PipelineShell>
    );
  }
  if (!health) return <PipelineShell />;

  const af = health.airflow;
  const fresh = health.freshness;
  const latest = af.available ? af.runs[0] : undefined;
  const lastState = latest?.state ?? null;
  const lvl: Level = lastState === "success" ? "good" : lastState === "failed" ? "critical" : lastState ? "warning" : "neutral";
  const runs = af.available ? [...af.runs].reverse() : []; // oldest → newest, newest on the right
  const hrs = fresh.hours_since_load;
  const warn = fresh.warn_after_hours || 36;
  const ratio = hrs == null ? 0 : Math.min(1, hrs / warn);
  const rawRows = health.table_counts.find((t) => t.table === "raw.statcast_pitches")?.rows ?? 0;

  return (
    <PipelineShell>
      <div className="run-summary">
        <span className={`status-badge ${lvl}`}>
          {ICON_FOR[lvl]}
          {latest ? latest.state : "no runs"}
        </span>
        <div className="run-meta">
          {latest ? (
            <>
              Last run loaded <b>{shortDate(latest.game_date)}</b> · {latest.duration_s != null ? `${latest.duration_s}s` : "–"}
              <br />
              {latest.run_type} · finished {ago(latest.end_date || latest.start_date)}
            </>
          ) : (
            (!af.available && af.reason) || "Airflow metadata not connected"
          )}
        </div>
      </div>
      <div className="runs">
        {runs.length ? (
          <>
            {TASKS.map((task) => (
              <span key={task} style={{ display: "contents" }}>
                <span>{TASK_LABEL[task]}</span>
                <div className="lanes">
                  {runs.map((r) => {
                    const ti = r.tasks.find((x) => x.task_id === task);
                    return (
                      <span
                        key={r.run_id}
                        className={`cell ${ti?.state || "none"}`}
                        onMouseMove={(e) => {
                          const dur =
                            ti?.start_date && ti?.end_date
                              ? `${((Date.parse(ti.end_date) - Date.parse(ti.start_date)) / 1000).toFixed(1)}s`
                              : "–";
                          tip.show(
                            e,
                            <>
                              <div className="t-title">
                                {TASK_LABEL[task]} · {shortDate(r.game_date)}
                              </div>
                              <TipRow k="State" v={ti?.state || "not run"} />
                              <TipRow k="Duration" v={dur} />
                              <TipRow k="Try" v={ti?.try_number ?? "–"} />
                              <TipRow k="Run" v={r.run_type} />
                            </>,
                          );
                        }}
                        onMouseLeave={tip.hide}
                      ></span>
                    );
                  })}
                </div>
              </span>
            ))}
            <span></span>
            <div className="axis-row">
              <span>{shortDate(runs[0].game_date)}</span>
              <span>{shortDate(runs[runs.length - 1].game_date)}</span>
            </div>
            <span></span>
            <div className="state-key">
              <span>
                <i className="cell success"></i>success
              </span>
              <span>
                <i className="cell skipped"></i>skipped (off day)
              </span>
              <span>
                <i className="cell failed"></i>failed
              </span>
            </div>
          </>
        ) : (
          <div className="runs-empty" style={{ gridColumn: "1/-1" }}>
            Bind <code>AIRFLOW_HYPERDRIVE</code> (or set <code>AIRFLOW_DATABASE_URL</code> locally) to show DAG runs here. The warehouse
            panels below still work without it.
          </div>
        )}
      </div>
      <div className="fresh">
        <div className="box">
          <div className="k">Last load</div>
          <div className="v">{hrs == null ? "–" : ago(fresh.last_loaded_at)}</div>
          <div className={`meter ${hrs != null && hrs > warn ? "warn" : ""}`} title={`dbt source freshness warns after ${warn} h`}>
            <span style={{ width: `${Math.max(3, ratio * 100)}%` }}></span>
          </div>
        </div>
        <div className="box">
          <div className="k">Latest game date</div>
          <div className="v">{shortDate(fresh.last_game_date)}</div>
          <div className="k">{rawRows.toLocaleString()} raw rows</div>
        </div>
      </div>
      <div className="sub-head">Pitches landed per game date</div>
      <RowsChart data={health.rows_by_date} />
      <details className="tables">
        <summary>Warehouse tables</summary>
        <ul>
          {health.table_counts.map((t) => (
            <li key={t.table}>
              <span>{t.table}</span>
              <span>{t.rows == null ? "missing" : t.rows.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </details>
    </PipelineShell>
  );
}

function PipelineShell({ children }: { children?: ReactNode }) {
  return (
    <div className="panel glass pipeline" id="pipeline">
      <div className="panel-head">
        <h2>Pipeline</h2>
        <span className="muted small mono">statcast_daily</span>
      </div>
      {children ?? (
        <>
          <div className="run-summary"></div>
          <div className="runs"></div>
        </>
      )}
    </div>
  );
}

/* ---------- alerts + leaders ---------- */
export function Alerts({ overview, onSelect }: { overview: Overview | null; onSelect: (id: number) => void }) {
  const a = overview?.alerts ?? [];
  return (
    <div className="panel glass alerts">
      <div className="panel-head">
        <h2>Velo alerts</h2>
        <span className="muted small">1.5+ mph under baseline after 3+ games</span>
      </div>
      <ul>
        {!overview ? null : a.length ? (
          a.map((r) => (
            <li key={`${r.pitcher_id}-${r.game_date}`} data-id={r.pitcher_id} onClick={() => onSelect(r.pitcher_id)}>
              <span className="ico">{Icon.flag}</span>
              <span>
                <div className="who">{displayName(r.pitcher_name)}</div>
                <div className="when">
                  {shortDate(r.game_date)} · {fmt(r.fb_velo_mph)} mph
                </div>
              </span>
              <span className="delta">{signed(r.velo_vs_baseline_mph)}</span>
            </li>
          ))
        ) : (
          <li className="empty">{Icon.check}No fastball velo drops flagged this season.</li>
        )}
      </ul>
    </div>
  );
}

const BOARDS: { board: Board; label: string }[] = [
  { board: "velo", label: "Velo" },
  { board: "ride", label: "Ride" },
  { board: "whiff", label: "Whiff" },
  { board: "consistency", label: "Release" },
];

export function Leaders({
  overview,
  board,
  onBoard,
  onSelect,
}: {
  overview: Overview | null;
  board: Board;
  onBoard: (b: Board) => void;
  onSelect: (id: number) => void;
}) {
  const rows = overview?.leaders[board] ?? [];
  const f = {
    velo: (v: number) => `${fmt(v)} mph`,
    ride: (v: number) => `${signed(v)} in`,
    whiff: (v: number) => pct(v, 1),
    consistency: (v: number) => `${fmt(v, 1)} in`,
  }[board];
  const vals = rows.map((r) => Math.abs(r.value));
  const lo = board === "consistency" ? 0 : Math.min(...vals) * 0.9;
  const hi = Math.max(...vals);
  return (
    <div className="panel glass leaders">
      <div className="panel-head">
        <h2>League leaders</h2>
      </div>
      <div className="tabs" role="tablist">
        {BOARDS.map((b) => (
          <button key={b.board} role="tab" type="button" aria-selected={board === b.board} onClick={() => onBoard(b.board)}>
            {b.label}
          </button>
        ))}
      </div>
      <ol>
        {!overview ? null : rows.length ? (
          rows.map((r, i) => {
            const w =
              board === "consistency"
                ? (Math.min(...vals) / Math.abs(r.value)) * 100
                : ((Math.abs(r.value) - lo) / (hi - lo || 1)) * 85 + 15;
            return (
              <li key={`${r.pitcher_id}-${r.pitch_type}`} data-id={r.pitcher_id} onClick={() => onSelect(r.pitcher_id)}>
                <span className="rank">{i + 1}</span>
                <span className="lname">
                  {displayName(r.pitcher_name)} <Chip type={r.pitch_type} />
                </span>
                <span className="lval">{f(r.value)}</span>
                <span></span>
                <span className="bar-cell">
                  <span style={{ width: `${w.toFixed(0)}%` }}></span>
                </span>
              </li>
            );
          })
        ) : (
          <li className="muted small">No qualifying pitchers.</li>
        )}
      </ol>
    </div>
  );
}
