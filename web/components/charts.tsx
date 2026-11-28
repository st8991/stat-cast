"use client";

import { useState } from "react";
import { fmt, niceTicks, ptClass, scale, shortDate, signed, sparkPath } from "@/lib/format";
import type { ArsenalRow, GameTrend, Health, PitchPoint, PitcherDetail } from "@/lib/types";
import { Chip, Icon, TipRow, useSize, useTip } from "./ui";

const dimIf = (hoverType: string | null, type: string) => (hoverType && type !== hoverType ? " dim" : "");

/* ---------- roster sparkline ---------- */
export function Sparkline({ values, flagged }: { values: number[]; flagged: boolean }) {
  const p = sparkPath(values);
  return (
    <svg viewBox="0 0 64 22" aria-hidden="true">
      {p && (
        <>
          <path className={`spark${flagged ? " spark-flag" : ""}`} d={p.d} />
          <circle className="spark-end" cx={p.end.cx} cy={p.end.cy} r={2.5} />
        </>
      )}
    </svg>
  );
}

/* ---------- movement plot ---------- */
// Per-pitch dots: up to MAX_PITCH_POINTS circles per chart.
function Dots({
  pitches,
  x,
  y,
  hoverType,
  pick,
}: {
  pitches: PitchPoint[];
  x: (v: number) => number;
  y: (v: number) => number;
  hoverType: string | null;
  pick: (p: PitchPoint) => [number | null, number | null];
}) {
  return (
    <g>
      {pitches.map((p, i) => {
        const [vx, vy] = pick(p);
        if (vx == null || vy == null) return null;
        return (
          <circle
            key={i}
            className={`pt-dot ${ptClass(p.pitch_type)}${dimIf(hoverType, p.pitch_type)}`}
            data-type={p.pitch_type}
            cx={x(vx)}
            cy={y(vy)}
            r={3}
          />
        );
      })}
    </g>
  );
}

const pickMovement = (p: PitchPoint): [number, number] => [p.arm_side_break_in, p.ivb_in];
const pickRelease = (p: PitchPoint): [number | null, number | null] => [p.release_x_ft, p.release_z_ft];

export function MovementChart({
  detail,
  hoverType,
  onHover,
}: {
  detail: PitcherDetail;
  hoverType: string | null;
  onHover: (t: string | null) => void;
}) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const tip = useTip();
  const d = detail;
  let svg = null;
  if (width > 0 && height > 0) {
    const m = { l: 40, r: 14, t: 10, b: 34 };
    const xs = d.pitches.map((p) => p.arm_side_break_in).concat(d.arsenal.map((a) => a.avg_arm_side_break_in));
    const ys = d.pitches.map((p) => p.ivb_in).concat(d.arsenal.map((a) => a.avg_ivb_in));
    const lim = Math.max(20, Math.ceil(Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 0) / 5) * 5 + 2);
    // Equal inches per pixel on both axes, so the shape of the arsenal is not distorted.
    const pw = width - m.l - m.r;
    const ph = height - m.t - m.b;
    const side = Math.min(pw, ph);
    const ox = m.l + (pw - side) / 2;
    const oy = m.t + (ph - side) / 2;
    const x = scale(-lim, lim, ox, ox + side);
    const y = scale(-lim, lim, oy + side, oy);
    const ticks = niceTicks(-lim, lim, 8);

    const tipFor = (a: ArsenalRow) => (
      <>
        <div className="t-title">
          <Chip type={a.pitch_type} /> {a.pitch_name}
        </div>
        <TipRow k="Avg IVB" v={`${fmt(a.avg_ivb_in)} in (${signed(a.ivb_vs_league_in)} vs lg)`} />
        <TipRow k="Arm-side break" v={`${fmt(a.avg_arm_side_break_in)} in (${signed(a.arm_side_vs_league_in)} vs lg)`} />
        <TipRow k="Velo" v={`${fmt(a.avg_velo_mph)} mph`} />
        <TipRow k="Spin" v={`${fmt(a.avg_spin_rpm, 0)} rpm`} />
        <TipRow k="Pitches" v={a.pitches} />
      </>
    );

    svg = (
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <clipPath id="mv-clip">
            <rect x={ox} y={oy} width={side} height={side} />
          </clipPath>
        </defs>
        <rect x={ox} y={oy} width={side} height={side} fill="var(--chart-surface)" opacity={0.35} rx={10} />
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "zero" : "grid"} x1={x(t)} x2={x(t)} y1={oy} y2={oy + side} />
            <line className={t === 0 ? "zero" : "grid"} y1={y(t)} y2={y(t)} x1={ox} x2={ox + side} />
            <text x={x(t)} y={oy + side + 14} textAnchor="middle">
              {t}
            </text>
            <text x={ox - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <text className="axis-title" x={ox + side} y={oy + side + 28} textAnchor="end">
          arm side →
        </text>
        <text className="axis-title" x={ox} y={oy + side + 28}>
          ← glove side
        </text>
        <text
          className="axis-title"
          x={0}
          y={0}
          transform={`translate(${ox - 30},${oy + side / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          induced vertical break, in
        </text>
        <g clipPath="url(#mv-clip)">
          <Dots pitches={d.pitches} x={x} y={y} hoverType={hoverType} pick={pickMovement} />
          <g>
            {/* League average per type (same hand) and a link from it to this pitcher's average. */}
            {d.arsenal.map((a) => {
              if (a.ivb_vs_league_in == null) return null;
              const lx = x(a.avg_arm_side_break_in - (a.arm_side_vs_league_in ?? 0));
              const ly = y(a.avg_ivb_in - (a.ivb_vs_league_in ?? 0));
              const s = 6;
              return (
                <g key={`lg-${a.pitch_type}`} data-type={a.pitch_type} className={`type-group${dimIf(hoverType, a.pitch_type)}`}>
                  <line className="league-link" x1={lx} y1={ly} x2={x(a.avg_arm_side_break_in)} y2={y(a.avg_ivb_in)} />
                  <path className="league-mark" d={`M${lx},${ly - s}L${lx + s},${ly}L${lx},${ly + s}L${lx - s},${ly}Z`} />
                </g>
              );
            })}
            {d.arsenal.map((a) => {
              const cx = x(a.avg_arm_side_break_in);
              const cy = y(a.avg_ivb_in);
              return (
                <g key={`avg-${a.pitch_type}`} data-type={a.pitch_type} className={`type-group${dimIf(hoverType, a.pitch_type)}`}>
                  <circle className={`halo ${ptClass(a.pitch_type)}`} cx={cx} cy={cy} r={9} />
                  <text className="lbl" x={cx + 13} y={cy + 4}>
                    {a.pitch_type}
                  </text>
                  <circle
                    className="hit"
                    cx={cx}
                    cy={cy}
                    r={18}
                    onMouseMove={(e) => {
                      onHover(a.pitch_type);
                      tip.show(e, tipFor(a));
                    }}
                    onMouseLeave={() => {
                      onHover(null);
                      tip.hide();
                    }}
                  />
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    );
  }
  return (
    <>
      <div className="chart-body" id="movement-chart" ref={ref}>
        {svg}
      </div>
      <div className="legend" id="movement-legend">
        {d.arsenal.map((a) => (
          <span key={a.pitch_type} data-type={a.pitch_type}>
            <i className={ptClass(a.pitch_type)}></i>
            {a.pitch_type} · {a.pitch_name}
          </span>
        ))}
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 1 11 6 6 11 1 6Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          league avg
        </span>
      </div>
    </>
  );
}

/* ---------- release point ---------- */
export function ReleaseChart({ detail, hoverType }: { detail: PitcherDetail; hoverType: string | null }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const tip = useTip();
  const d = detail;
  const rel = d.release;
  const pts = d.pitches.filter((p) => p.release_x_ft != null && p.release_z_ft != null);
  let svg = null;
  if (width > 0 && height > 0 && pts.length) {
    const m = { l: 40, r: 10, t: 6, b: 24 };
    const cx0 = rel ? rel.release_x_ft : pts.reduce((s, p) => s + p.release_x_ft!, 0) / pts.length;
    const cz0 = rel ? rel.release_z_ft : pts.reduce((s, p) => s + p.release_z_ft!, 0) / pts.length;
    const half = 9 / 12; // ±9 inches, same window for every pitcher so spreads compare
    const pw = width - m.l - m.r;
    const ph = height - m.t - m.b;
    const ppf = Math.min(pw, ph) / (2 * half); // pixels per foot, equal on both axes
    const ox = m.l + pw / 2;
    const oy = m.t + ph / 2;
    const x = (v: number) => ox + (v - cx0) * ppf;
    const y = (v: number) => oy - (v - cz0) * ppf;
    const xr = pw / 2 / ppf;
    const zr = ph / 2 / ppf;
    const step = 0.25; // 3-inch grid
    const labelEvery = (px: number) => [1, 2, 4, 8].find((k) => k * step * ppf >= px) || 8;
    const lx = labelEvery(44);
    const lz = labelEvery(18);
    const dec = (every: number) => (every * step >= 1 ? 0 : every * step >= 0.5 ? 1 : 2);
    const gridX: number[] = [];
    for (let k = Math.ceil((cx0 - xr) / step); k * step <= cx0 + xr; k++) gridX.push(k);
    const gridZ: number[] = [];
    for (let k = Math.ceil((cz0 - zr) / step); k * step <= cz0 + zr; k++) gridZ.push(k);

    svg = (
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={m.l} y={m.t} width={pw} height={ph} fill="var(--chart-surface)" opacity={0.35} rx={10} />
        {gridX.map((k) => (
          <g key={`x${k}`}>
            <line className="grid" x1={x(k * step)} x2={x(k * step)} y1={m.t} y2={m.t + ph} />
            {k % lx === 0 && (
              <text x={x(k * step)} y={m.t + ph + 14} textAnchor="middle">
                {(k * step).toFixed(dec(lx))}
              </text>
            )}
          </g>
        ))}
        {gridZ.map((k) => (
          <g key={`z${k}`}>
            <line className="grid" y1={y(k * step)} y2={y(k * step)} x1={m.l} x2={m.l + pw} />
            {k % lz === 0 && (
              <text x={m.l - 6} y={y(k * step) + 4} textAnchor="end">
                {(k * step).toFixed(dec(lz))}
              </text>
            )}
          </g>
        ))}
        <defs>
          <clipPath id="rel-clip">
            <rect x={m.l} y={m.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        <g clipPath="url(#rel-clip)">
          <Dots pitches={pts} x={x} y={y} hoverType={hoverType} pick={pickRelease} />
          {rel && (
            <ellipse
              className="ellipse"
              cx={x(cx0)}
              cy={y(cz0)}
              rx={(rel.release_x_sd_in / 12) * ppf}
              ry={(rel.release_z_sd_in / 12) * ppf}
            />
          )}
        </g>
        <rect
          className="hit"
          x={m.l}
          y={m.t}
          width={pw}
          height={ph}
          onMouseMove={(e) => {
            if (!rel) return;
            tip.show(
              e,
              <>
                <div className="t-title">Release cloud</div>
                <TipRow k="Center (x, z)" v={`${fmt(rel.release_x_ft, 2)}, ${fmt(rel.release_z_ft, 2)} ft`} />
                <TipRow k="SD horiz / vert" v={`${fmt(rel.release_x_sd_in, 1)} / ${fmt(rel.release_z_sd_in, 1)} in`} />
                <TipRow k="Extension SD" v={`${fmt(rel.extension_sd_in, 1)} in`} />
                <TipRow k="Arm angle SD" v={`${fmt(rel.arm_angle_sd_deg, 1)}°`} />
                <TipRow k="Max tunnel gap" v={`${fmt(rel.max_tunnel_gap_in, 1)} in vs ${rel.primary_pitch_type}`} />
              </>,
            );
          }}
          onMouseLeave={tip.hide}
        />
      </svg>
    );
  }
  return (
    <div className="chart-body" id="release-chart" ref={ref}>
      {svg}
    </div>
  );
}

/* ---------- velo by game ---------- */
export function VeloChart({ trends }: { trends: GameTrend[] }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const tip = useTip();
  const t = trends;
  let svg = null;
  if (width > 0 && height > 0) {
    if (!t.length) {
      svg = (
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          <text x={width / 2} y={height / 2} textAnchor="middle">
            No fastballs thrown yet
          </text>
        </svg>
      );
    } else {
      const m = { l: 40, r: 14, t: 10, b: 24 };
      const vals = t.flatMap((g) => [g.fb_velo_mph, g.fb_max_velo_mph, g.fb_velo_mph - (g.velo_vs_baseline_mph ?? 0)]);
      const lo = Math.floor(Math.min(...vals) - 0.5);
      const hi = Math.ceil(Math.max(...vals) + 0.5);
      const n = t.length;
      const x = n === 1 ? () => m.l + (width - m.l - m.r) / 2 : scale(0, n - 1, m.l + 14, width - m.r - 14);
      const y = scale(lo, hi, height - m.b, m.t);
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((width - m.l) / 56))));
      const base = t
        .map((g, i) => (g.prior_games > 0 && g.velo_vs_baseline_mph != null ? [x(i), y(g.fb_velo_mph - g.velo_vs_baseline_mph)] : null))
        .filter((p): p is number[] => p != null);
      const line = t.map((g, i) => `${i ? "L" : "M"}${x(i)},${y(g.fb_velo_mph)}`).join("");

      svg = (
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          {niceTicks(lo, hi, 4).map((v) => (
            <g key={v}>
              <line className="grid" x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} />
              <text x={m.l - 6} y={y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {t.map((g, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={g.game_pk} x={x(i)} y={height - 6} textAnchor="middle">
                {shortDate(g.game_date)}
              </text>
            ) : null,
          )}
          <defs>
            <linearGradient id="velo-fill" x1={0} x2={0} y1={0} y2={1}>
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {base.length > 1 && <path className="baseline" d={base.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("")} />}
          {n > 1 && (
            <>
              <path className="area" d={`${line}L${x(n - 1)},${height - m.b}L${x(0)},${height - m.b}Z`} />
              <path className="line" d={line} />
            </>
          )}
          {t.map((g, i) => {
            const cx = x(i);
            const cy = y(g.fb_velo_mph);
            return (
              <g key={g.game_pk}>
                <circle className="max-dot" cx={cx} cy={y(g.fb_max_velo_mph)} r={2.5} />
                {g.velo_drop_flag ? (
                  <path className="flag-mark" d={`M${cx},${cy - 9}L${cx + 8},${cy + 5}L${cx - 8},${cy + 5}Z`} />
                ) : (
                  <circle cx={cx} cy={cy} r={4.5} fill="var(--accent)" className="halo" />
                )}
              </g>
            );
          })}
          <line
            className="cursor"
            x1={cursor == null ? 0 : x(cursor)}
            x2={cursor == null ? 0 : x(cursor)}
            y1={m.t}
            y2={height - m.b}
            visibility={cursor == null ? "hidden" : "visible"}
          />
          <rect
            className="hit"
            x={m.l}
            y={0}
            width={width - m.l}
            height={height}
            onMouseMove={(e) => {
              const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * width;
              let best = 0;
              t.forEach((_, i) => {
                if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
              });
              const g = t[best];
              setCursor(best);
              tip.show(
                e,
                <>
                  <div className="t-title">
                    {shortDate(g.game_date)}
                    {g.velo_drop_flag && (
                      <>
                        {" "}
                        <span className="flag">{Icon.flag} velo drop</span>
                      </>
                    )}
                  </div>
                  <TipRow k="Avg FB velo" v={`${fmt(g.fb_velo_mph)} mph`} />
                  <TipRow k="Max" v={`${fmt(g.fb_max_velo_mph)} mph`} />
                  <TipRow k="vs prior games" v={g.prior_games ? `${signed(g.velo_vs_baseline_mph)} mph` : "first game"} />
                  <TipRow k="Release height" v={`${fmt(g.release_z_ft, 2)} ft (${signed(g.release_z_vs_baseline_in)} in)`} />
                  <TipRow k="Fastballs" v={g.fastballs} />
                </>,
              );
            }}
            onMouseLeave={() => {
              setCursor(null);
              tip.hide();
            }}
          />
        </svg>
      );
    }
  }
  return (
    <div className="chart-body" id="velo-chart" ref={ref}>
      {svg}
    </div>
  );
}

/* ---------- pitches landed per game date ---------- */
export function RowsChart({ data }: { data: Health["rows_by_date"] }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tip = useTip();
  let svg = null;
  if (width > 0 && height > 0 && data.length) {
    const m = { l: 2, r: 2, t: 4, b: 16 };
    const max = Math.max(...data.map((d) => d.pitches));
    const bw = (width - m.l - m.r) / data.length;
    const y = scale(0, max, height - m.b, m.t);
    svg = (
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <line className="zero" x1={m.l} x2={width - m.r} y1={height - m.b} y2={height - m.b} />
        {data.map((d, i) => {
          const x0 = m.l + i * bw + 1;
          const w = Math.max(2, bw - 2);
          const top = y(d.pitches);
          const base = height - m.b;
          const r = Math.min(4, w / 2);
          return (
            <g key={d.game_date}>
              <path
                className="bar"
                style={hover === i ? { opacity: 0.8 } : undefined}
                d={`M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base}Z`}
              />
              {(i === 0 || i === data.length - 1) && (
                <text x={x0 + w / 2} y={height - 3} textAnchor="middle">
                  {shortDate(d.game_date)}
                </text>
              )}
              <rect
                className="hit"
                x={m.l + i * bw}
                y={0}
                width={bw}
                height={height}
                onMouseMove={(e) => {
                  setHover(i);
                  tip.show(
                    e,
                    <>
                      <div className="t-title">{shortDate(d.game_date)}</div>
                      <TipRow k="Pitches" v={d.pitches.toLocaleString()} />
                      <TipRow k="Games" v={d.games} />
                    </>,
                  );
                }}
                onMouseLeave={() => {
                  setHover(null);
                  tip.hide();
                }}
              />
            </g>
          );
        })}
      </svg>
    );
  }
  return (
    <div id="rows-chart" className="rows-chart" ref={ref}>
      {svg}
    </div>
  );
}
