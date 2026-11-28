/* stat-cast dashboard. No build step, no framework: fetch JSON, draw SVG. */
(() => {
  "use strict";

  const API = "api/";
  const PITCH_TYPES = ["FF", "SI", "FC", "SL", "ST", "CU", "CH", "FS"];
  const PITCH_NAMES = {
    FF: "4-Seam", SI: "Sinker", FC: "Cutter", SL: "Slider", ST: "Sweeper",
    CU: "Curveball", CH: "Changeup", FS: "Splitter",
  };
  const TASKS = ["resolve_game_date", "extract", "has_pitches", "load", "dbt_build"];
  const TASK_LABEL = { resolve_game_date: "resolve", extract: "extract", has_pitches: "has pitches", load: "load", dbt_build: "dbt build" };
  const NS = "http://www.w3.org/2000/svg";

  const state = { overview: null, health: null, pitcher: null, selected: null, hand: "", query: "", board: "velo", hoverType: null };
  const $ = (sel) => document.querySelector(sel);

  /* ---------- helpers ---------- */
  const ptClass = (t) => `pt-${PITCH_TYPES.includes(t) ? t : "XX"}`;
  const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
  const pct = (v, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
  const signed = (v, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const displayName = (n) => {
    if (!n) return "";
    const [last, first] = n.split(",").map((s) => s.trim());
    return first ? `${first} ${last}` : n;
  };
  const shortDate = (iso) => {
    if (!iso) return "–";
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const ago = (iso) => {
    if (!iso) return "–";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
  const chip = (t) => `<span class="chip"><i class="${ptClass(t)}"></i>${esc(t)}</span>`;
  const icon = {
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    dash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
  };

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgFor(container) {
    container.innerHTML = "";
    const { width, height } = container.getBoundingClientRect();
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" }, container);
    return { svg, width, height };
  }
  const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  function niceTicks(lo, hi, count = 5) {
    const step0 = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  /* ---------- tooltip ---------- */
  const tip = $("#tooltip");
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14, r = tip.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  const row = (k, v) => `<div class="t-row"><span>${esc(k)}</span><b>${v}</b></div>`;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 6000);
  }

  /* ---------- data ---------- */
  async function getJSON(path) {
    const res = await fetch(API + path, { cache: "no-store" });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json();
  }

  /* ---------- header ---------- */
  function renderTicker() {
    const o = state.overview, t = o.totals;
    const parts = [
      `Season <b>${o.season}</b>`,
      `Data through <b>${shortDate(t.last_game_date)}</b>`,
      `<b>${Number(t.pitches).toLocaleString()}</b> pitches`,
      `<b>${t.pitchers}</b> pitchers`,
      `<b>${t.games}</b> games`,
    ];
    $("#ticker").innerHTML = parts.join('<span class="sep"></span>');
  }

  /* ---------- roster ---------- */
  function sparkline(values, flagged) {
    const w = 64, h = 22;
    if (!values || values.length < 2) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
    const lo = Math.min(...values) - 0.3, hi = Math.max(...values) + 0.3;
    const x = scale(0, values.length - 1, 2, w - 3), y = scale(lo, hi, h - 3, 3);
    const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const last = values.length - 1;
    return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="spark${flagged ? " spark-flag" : ""}" d="${d}"/><circle class="spark-end" cx="${x(last)}" cy="${y(values[last])}" r="2.5"/></svg>`;
  }

  function renderRoster() {
    const q = state.query.toLowerCase();
    const list = state.overview.pitchers.filter((p) => {
      if (state.hand === "flag" && !p.any_velo_drop) return false;
      if (state.hand && state.hand !== "flag" && p.pitcher_hand !== state.hand) return false;
      return !q || `${p.pitcher_name} ${displayName(p.pitcher_name)} ${p.latest_team}`.toLowerCase().includes(q);
    });
    $("#roster-count").textContent = `${list.length} of ${state.overview.pitchers.length}`;
    const ul = $("#roster");
    ul.innerHTML = list.map((p) => `
      <li role="option" tabindex="0" data-id="${p.pitcher_id}" aria-selected="${p.pitcher_id === state.selected}">
        <span class="r-name">${esc(displayName(p.pitcher_name))}${p.any_velo_drop ? `<span class="flag" title="Fastball velo drop flagged">${icon.flag}</span>` : ""}</span>
        <span class="r-meta">${p.pitcher_hand}HP · ${esc(p.latest_team)} · ${p.pitches} P ${p.primary_pitch_type ? chip(p.primary_pitch_type) : ""}</span>
        <span class="r-spark">${sparkline(p.fb_velo_by_game, p.last_game_velo_drop)}<span class="v">${fmt(p.last_fb_velo_mph)}</span></span>
      </li>`).join("") || '<li class="muted small" style="cursor:default">No pitchers match.</li>';
  }

  /* ---------- hero + KPIs ---------- */
  function renderHero() {
    const d = state.pitcher, p = d.profile, ars = d.arsenal;
    $("#hero-kicker").innerHTML = `${p.pitcher_hand === "L" ? "Left" : "Right"}-handed · ${esc(p.latest_team)} · ${p.games} G · ${p.pitches.toLocaleString()} pitches · ${shortDate(p.first_game_date)} – ${shortDate(p.last_game_date)}`;
    $("#hero-name").textContent = displayName(p.pitcher_name);
    $("#hero-mix").innerHTML = ars.map((a) => `<span class="${ptClass(a.pitch_type)}" style="flex:${a.usage_pct}" title="${esc(a.pitch_type)} ${pct(a.usage_pct)}"></span>`).join("");

    const total = ars.reduce((s, a) => s + a.pitches, 0) || 1;
    const wavg = (k) => ars.reduce((s, a) => s + (a[k] ?? 0) * a.pitches, 0) / total;
    const fb = ars.find((a) => ["FF", "SI", "FC"].includes(a.pitch_type));
    const bestWhiff = ars.filter((a) => a.whiff_pct != null).sort((a, b) => b.whiff_pct - a.whiff_pct)[0];
    const rel = d.release;
    const csw = wavg("csw_pct"), rv = wavg("run_value_per_100");
    const tiles = [
      fb
        ? { k: `${PITCH_NAMES[fb.pitch_type] || fb.pitch_type} velo`, v: `${fmt(fb.avg_velo_mph)}<small>mph</small>`,
            d: `<span class="${fb.velo_vs_league_mph >= 0 ? "up" : "down"}">${signed(fb.velo_vs_league_mph)}</span> vs league avg` }
        : { k: "Fastball velo", v: "–", d: "no fastball" },
      { k: "CSW%", v: pct(csw, 1), d: bestWhiff ? `best whiff ${bestWhiff.pitch_type} ${pct(bestWhiff.whiff_pct)}` : "" },
      { k: "Run value / 100", v: signed(rv, 2), d: `<span class="${rv >= 0 ? "up" : "down"}">${rv >= 0 ? "▲ saves runs" : "▼ costs runs"}</span>` },
      rel
        ? { k: "Release spread", v: `${fmt(rel.release_spread_in, 1)}<small>in</small>`, d: `${ordinal(Math.round((rel.consistency_pctile ?? 0) * 100))} pctile` }
        : { k: "Release spread", v: "–", d: "" },
    ];
    $("#kpis").innerHTML = tiles.map((t) => `<div class="kpi"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`).join("");
  }

  /* ---------- movement plot ---------- */
  function renderMovement() {
    const d = state.pitcher, box = $("#movement-chart");
    const { svg, width, height } = svgFor(box);
    const m = { l: 40, r: 14, t: 10, b: 34 };
    const league = Object.fromEntries((state.overview.league_shape || []).map((s) => [s.pitch_type, s]));
    const xs = d.pitches.map((p) => p.arm_side_break_in).concat(d.arsenal.map((a) => a.avg_arm_side_break_in));
    const ys = d.pitches.map((p) => p.ivb_in).concat(d.arsenal.map((a) => a.avg_ivb_in));
    const lim = Math.max(20, Math.ceil(Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 0) / 5) * 5 + 2);
    // Equal inches per pixel on both axes, so the shape of the arsenal is not distorted.
    const pw = width - m.l - m.r, ph = height - m.t - m.b, side = Math.min(pw, ph);
    const ox = m.l + (pw - side) / 2, oy = m.t + (ph - side) / 2;
    const x = scale(-lim, lim, ox, ox + side), y = scale(-lim, lim, oy + side, oy);

    const defs = el("defs", {}, svg);
    const clip = el("clipPath", { id: "mv-clip" }, defs);
    el("rect", { x: ox, y: oy, width: side, height: side }, clip);
    el("rect", { x: ox, y: oy, width: side, height: side, fill: "var(--chart-surface)", opacity: 0.35, rx: 10 }, svg);
    for (const t of niceTicks(-lim, lim, 8)) {
      el("line", { class: t === 0 ? "zero" : "grid", x1: x(t), x2: x(t), y1: oy, y2: oy + side }, svg);
      el("line", { class: t === 0 ? "zero" : "grid", y1: y(t), y2: y(t), x1: ox, x2: ox + side }, svg);
      el("text", { x: x(t), y: oy + side + 14, "text-anchor": "middle" }, svg).textContent = t;
      el("text", { x: ox - 6, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = t;
    }
    el("text", { class: "axis-title", x: ox + side, y: oy + side + 28, "text-anchor": "end" }, svg).textContent = "arm side →";
    el("text", { class: "axis-title", x: ox, y: oy + side + 28 }, svg).textContent = "← glove side";
    const yt = el("text", { class: "axis-title", x: 0, y: 0, transform: `translate(${ox - 30},${oy + side / 2}) rotate(-90)`, "text-anchor": "middle" }, svg);
    yt.textContent = "induced vertical break, in";

    const plot = el("g", { "clip-path": "url(#mv-clip)" }, svg);
    const dots = el("g", {}, plot);
    for (const p of d.pitches) {
      el("circle", { class: `pt-dot ${ptClass(p.pitch_type)}`, "data-type": p.pitch_type, cx: x(p.arm_side_break_in), cy: y(p.ivb_in), r: 3 }, dots);
    }
    // League average per type (same hand) and a link from it to this pitcher's average.
    const marks = el("g", {}, plot);
    for (const a of d.arsenal) {
      const lx = a.avg_arm_side_break_in - (a.arm_side_vs_league_in ?? 0), ly = a.avg_ivb_in - (a.ivb_vs_league_in ?? 0);
      const g = el("g", { "data-type": a.pitch_type, class: "type-group" }, marks);
      if (a.ivb_vs_league_in != null) {
        el("line", { class: "league-link", x1: x(lx), y1: y(ly), x2: x(a.avg_arm_side_break_in), y2: y(a.avg_ivb_in) }, g);
        const s = 6;
        el("path", { class: "league-mark", d: `M${x(lx)},${y(ly) - s}L${x(lx) + s},${y(ly)}L${x(lx)},${y(ly) + s}L${x(lx) - s},${y(ly)}Z` }, g);
      }
    }
    for (const a of d.arsenal) {
      const cx = x(a.avg_arm_side_break_in), cy = y(a.avg_ivb_in);
      const g = el("g", { "data-type": a.pitch_type, class: "type-group" }, marks);
      el("circle", { class: `halo ${ptClass(a.pitch_type)}`, cx, cy, r: 9 }, g);
      el("text", { class: "lbl", x: cx + 13, y: cy + 4 }, g).textContent = a.pitch_type;
      const hit = el("circle", { class: "hit", cx, cy, r: 18 }, g);
      hit.addEventListener("mousemove", (e) => {
        highlightType(a.pitch_type);
        showTip(e, `<div class="t-title">${chip(a.pitch_type)} ${esc(a.pitch_name)}</div>
          ${row("Avg IVB", `${fmt(a.avg_ivb_in)} in (${signed(a.ivb_vs_league_in)} vs lg)`)}
          ${row("Arm-side break", `${fmt(a.avg_arm_side_break_in)} in (${signed(a.arm_side_vs_league_in)} vs lg)`)}
          ${row("Velo", `${fmt(a.avg_velo_mph)} mph`)}
          ${row("Spin", `${fmt(a.avg_spin_rpm, 0)} rpm`)}
          ${row("Pitches", a.pitches)}`);
      });
      hit.addEventListener("mouseleave", () => { highlightType(null); hideTip(); });
    }
    $("#movement-legend").innerHTML = d.arsenal.map((a) => `<span data-type="${a.pitch_type}"><i class="${ptClass(a.pitch_type)}"></i>${esc(a.pitch_type)} · ${esc(a.pitch_name)}</span>`).join("")
      + '<span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>league avg</span>';
  }

  function highlightType(type) {
    state.hoverType = type;
    document.querySelectorAll("#movement-chart [data-type], #release-chart [data-type]").forEach((n) => {
      n.classList.toggle("dim", !!type && n.dataset.type !== type);
    });
    document.querySelectorAll("#arsenal-table tbody tr").forEach((tr) => tr.classList.toggle("hl", tr.dataset.type === type));
  }

  /* ---------- release point ---------- */
  function renderRelease() {
    const d = state.pitcher, rel = d.release, box = $("#release-chart");
    const { svg, width, height } = svgFor(box);
    const m = { l: 40, r: 10, t: 6, b: 24 };
    const pts = d.pitches.filter((p) => p.release_x_ft != null && p.release_z_ft != null);
    if (!pts.length) return;
    const cx0 = rel ? rel.release_x_ft : pts.reduce((s, p) => s + p.release_x_ft, 0) / pts.length;
    const cz0 = rel ? rel.release_z_ft : pts.reduce((s, p) => s + p.release_z_ft, 0) / pts.length;
    const half = 9 / 12; // ±9 inches, same window for every pitcher so spreads compare
    const pw = width - m.l - m.r, ph = height - m.t - m.b;
    const ppf = Math.min(pw, ph) / (2 * half); // pixels per foot, equal on both axes
    const ox = m.l + pw / 2, oy = m.t + ph / 2;
    const x = (v) => ox + (v - cx0) * ppf, y = (v) => oy - (v - cz0) * ppf;
    const xr = pw / 2 / ppf, zr = ph / 2 / ppf;

    el("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "var(--chart-surface)", opacity: 0.35, rx: 10 }, svg);
    const step = 0.25; // 3-inch grid
    const labelEvery = (px) => [1, 2, 4, 8].find((k) => k * step * ppf >= px) || 8;
    const lx = labelEvery(44), lz = labelEvery(18);
    const dec = (every) => (every * step >= 1 ? 0 : every * step >= 0.5 ? 1 : 2);
    for (let k = Math.ceil((cx0 - xr) / step); k * step <= cx0 + xr; k++) {
      const v = k * step;
      el("line", { class: "grid", x1: x(v), x2: x(v), y1: m.t, y2: m.t + ph }, svg);
      if (k % lx === 0) el("text", { x: x(v), y: m.t + ph + 14, "text-anchor": "middle" }, svg).textContent = v.toFixed(dec(lx));
    }
    for (let k = Math.ceil((cz0 - zr) / step); k * step <= cz0 + zr; k++) {
      const v = k * step;
      el("line", { class: "grid", y1: y(v), y2: y(v), x1: m.l, x2: m.l + pw }, svg);
      if (k % lz === 0) el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = v.toFixed(dec(lz));
    }
    const clipId = "rel-clip";
    el("rect", { x: m.l, y: m.t, width: pw, height: ph }, el("clipPath", { id: clipId }, el("defs", {}, svg)));
    const g = el("g", { "clip-path": `url(#${clipId})` }, svg);
    for (const p of pts) el("circle", { class: `pt-dot ${ptClass(p.pitch_type)}`, "data-type": p.pitch_type, cx: x(p.release_x_ft), cy: y(p.release_z_ft), r: 3 }, g);
    if (rel) {
      el("ellipse", { class: "ellipse", cx: x(cx0), cy: y(cz0), rx: (rel.release_x_sd_in / 12) * ppf, ry: (rel.release_z_sd_in / 12) * ppf }, g);
    }
    const lg = d.league_release;
    $("#release-stat").innerHTML = rel
      ? `<b>${fmt(rel.release_spread_in, 1)} in</b>spread · lg ${fmt(lg?.avg_release_spread_in, 1)}`
      : "";
    const hit = el("rect", { class: "hit", x: m.l, y: m.t, width: pw, height: ph }, svg);
    hit.addEventListener("mousemove", (e) => {
      if (!rel) return;
      showTip(e, `<div class="t-title">Release cloud</div>
        ${row("Center (x, z)", `${fmt(rel.release_x_ft, 2)}, ${fmt(rel.release_z_ft, 2)} ft`)}
        ${row("SD horiz / vert", `${fmt(rel.release_x_sd_in, 1)} / ${fmt(rel.release_z_sd_in, 1)} in`)}
        ${row("Extension SD", `${fmt(rel.extension_sd_in, 1)} in`)}
        ${row("Arm angle SD", `${fmt(rel.arm_angle_sd_deg, 1)}°`)}
        ${row("Max tunnel gap", `${fmt(rel.max_tunnel_gap_in, 1)} in vs ${rel.primary_pitch_type}`)}`);
    });
    hit.addEventListener("mouseleave", hideTip);
  }

  /* ---------- velo by game ---------- */
  function renderVelo() {
    const t = state.pitcher.trends, box = $("#velo-chart");
    const { svg, width, height } = svgFor(box);
    const last = t[t.length - 1];
    $("#velo-stat").innerHTML = last
      ? `<b>${fmt(last.fb_velo_mph)} mph</b>last game ${last.velo_vs_baseline_mph != null ? `<span class="${last.velo_vs_baseline_mph >= 0 ? "up" : "down"}">${signed(last.velo_vs_baseline_mph)}</span>` : ""}`
      : "";
    if (!t.length) {
      el("text", { x: width / 2, y: height / 2, "text-anchor": "middle" }, svg).textContent = "No fastballs thrown yet";
      return;
    }
    const m = { l: 40, r: 14, t: 10, b: 24 };
    const vals = t.flatMap((g) => [g.fb_velo_mph, g.fb_max_velo_mph, g.fb_velo_mph - (g.velo_vs_baseline_mph ?? 0)]);
    const lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
    const n = t.length;
    const x = n === 1 ? () => m.l + (width - m.l - m.r) / 2 : scale(0, n - 1, m.l + 14, width - m.r - 14);
    const y = scale(lo, hi, height - m.b, m.t);
    for (const v of niceTicks(lo, hi, 4)) {
      el("line", { class: "grid", x1: m.l, x2: width - m.r, y1: y(v), y2: y(v) }, svg);
      el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = v;
    }
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((width - m.l) / 56))));
    t.forEach((g, i) => {
      if (i % every === 0 || i === n - 1) el("text", { x: x(i), y: height - 6, "text-anchor": "middle" }, svg).textContent = shortDate(g.game_date);
    });
    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: "velo-fill", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": 0.28 }, grad);
    el("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": 0 }, grad);

    const base = t.map((g, i) => (g.prior_games > 0 && g.velo_vs_baseline_mph != null ? [x(i), y(g.fb_velo_mph - g.velo_vs_baseline_mph)] : null)).filter(Boolean);
    if (base.length > 1) el("path", { class: "baseline", d: base.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("") }, svg);
    if (n > 1) {
      const line = t.map((g, i) => `${i ? "L" : "M"}${x(i)},${y(g.fb_velo_mph)}`).join("");
      el("path", { class: "area", d: `${line}L${x(n - 1)},${height - m.b}L${x(0)},${height - m.b}Z` }, svg);
      el("path", { class: "line", d: line }, svg);
    }
    t.forEach((g, i) => {
      el("circle", { class: "max-dot", cx: x(i), cy: y(g.fb_max_velo_mph), r: 2.5 }, svg);
      if (g.velo_drop_flag) {
        const cx = x(i), cy = y(g.fb_velo_mph);
        el("path", { class: "flag-mark", d: `M${cx},${cy - 9}L${cx + 8},${cy + 5}L${cx - 8},${cy + 5}Z` }, svg);
      } else {
        el("circle", { cx: x(i), cy: y(g.fb_velo_mph), r: 4.5, fill: "var(--accent)", class: "halo" }, svg);
      }
    });
    const cursor = el("line", { class: "cursor", y1: m.t, y2: height - m.b, visibility: "hidden" }, svg);
    const hit = el("rect", { class: "hit", x: m.l, y: 0, width: width - m.l, height }, svg);
    hit.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * width;
      let best = 0;
      t.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      const g = t[best];
      cursor.setAttribute("x1", x(best)); cursor.setAttribute("x2", x(best)); cursor.setAttribute("visibility", "visible");
      showTip(e, `<div class="t-title">${shortDate(g.game_date)}${g.velo_drop_flag ? ` <span class="flag">${icon.flag} velo drop</span>` : ""}</div>
        ${row("Avg FB velo", `${fmt(g.fb_velo_mph)} mph`)}
        ${row("Max", `${fmt(g.fb_max_velo_mph)} mph`)}
        ${row("vs prior games", g.prior_games ? `${signed(g.velo_vs_baseline_mph)} mph` : "first game")}
        ${row("Release height", `${fmt(g.release_z_ft, 2)} ft (${signed(g.release_z_vs_baseline_in)} in)`)}
        ${row("Fastballs", g.fastballs)}`);
    });
    hit.addEventListener("mouseleave", () => { cursor.setAttribute("visibility", "hidden"); hideTip(); });
  }

  /* ---------- arsenal table ---------- */
  function renderArsenal() {
    const ars = state.pitcher.arsenal;
    const vs = (v, unit = "", good = 1) => v == null ? "" : `<span class="vs ${v * good > 0.05 ? "up" : v * good < -0.05 ? "down" : "muted"}">${signed(v)}${unit}</span>`;
    const head = `<thead><tr><th>Pitch</th><th>Usage</th><th>Velo</th><th>Spin</th><th>IVB</th><th>Arm-side</th><th>Ext</th><th>Whiff%</th><th>CSW%</th><th>Zone%</th><th>Chase%</th><th>xwOBAcon</th><th>RV/100</th></tr></thead>`;
    const body = ars.map((a) => `
      <tr data-type="${a.pitch_type}">
        <td>${chip(a.pitch_type)}<span class="name">${esc(a.pitch_name)}</span></td>
        <td><div class="usage"><span>${pct(a.usage_pct, 1)}</span><span class="track"><span class="fill ${ptClass(a.pitch_type)}" style="width:${(a.usage_pct * 100).toFixed(1)}%"></span></span></div></td>
        <td class="num-strong">${fmt(a.avg_velo_mph)}${vs(a.velo_vs_league_mph)}</td>
        <td>${fmt(a.avg_spin_rpm, 0)}</td>
        <td class="num-strong">${fmt(a.avg_ivb_in)}${vs(a.ivb_vs_league_in, "", 0)}</td>
        <td class="num-strong">${fmt(a.avg_arm_side_break_in)}${vs(a.arm_side_vs_league_in, "", 0)}</td>
        <td>${fmt(a.avg_extension_ft, 1)}</td>
        <td>${pct(a.whiff_pct, 1)}</td>
        <td>${pct(a.csw_pct, 1)}</td>
        <td>${pct(a.zone_pct, 0)}</td>
        <td>${pct(a.chase_pct, 0)}</td>
        <td>${fmt(a.xwoba_on_contact, 3).replace(/^0/, "")}</td>
        <td class="num-strong ${a.run_value_per_100 >= 0 ? "up" : "down"}">${signed(a.run_value_per_100, 2)}</td>
      </tr>`).join("");
    const tbl = $("#arsenal-table");
    tbl.innerHTML = head + `<tbody>${body}</tbody>`;
    tbl.querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("mouseenter", () => highlightType(tr.dataset.type));
      tr.addEventListener("mouseleave", () => highlightType(null));
    });
  }

  /* ---------- pipeline ---------- */
  function pipelineStatus(h) {
    const af = h.airflow || {};
    const latest = af.available && af.runs && af.runs[0];
    const fresh = h.freshness || {};
    const stale = fresh.hours_since_load != null && fresh.hours_since_load > fresh.warn_after_hours;
    if (latest && latest.state === "failed") return { level: "critical", word: "Last run failed" };
    if (latest && ["running", "queued"].includes(latest.state)) return { level: "good", word: "Running now" };
    if (h.mode === "snapshot") return { level: "neutral", word: "Snapshot" };
    if (stale) return { level: "warning", word: "Data is stale" };
    if (latest && latest.state === "success") return { level: "good", word: "Healthy" };
    return { level: "neutral", word: af.available ? "No runs yet" : "Warehouse only" };
  }

  function renderPipeline() {
    const h = state.health, af = h.airflow || {}, fresh = h.freshness || {};
    const st = pipelineStatus(h);
    const pill = $("#pipeline-pill");
    pill.dataset.state = st.level;
    pill.querySelector(".label").textContent = st.word;

    const badge = $("#mode-badge");
    if (h.mode === "snapshot") {
      badge.hidden = false;
      badge.textContent = "Snapshot";
      badge.title = `Static export from ${new Date(h.exported_at).toLocaleString()}`;
    }

    const latest = af.available && af.runs?.[0];
    const iconFor = { good: icon.check, warning: icon.clock, critical: icon.x, neutral: icon.dash };
    const lastState = latest ? latest.state : null;
    const lvl = lastState === "success" ? "good" : lastState === "failed" ? "critical" : lastState ? "warning" : "neutral";
    $("#run-summary").innerHTML = `
      <span class="status-badge ${lvl}">${iconFor[lvl]}${latest ? esc(latest.state) : "no runs"}</span>
      <div class="run-meta">${latest
        ? `Last run loaded <b>${shortDate(latest.game_date)}</b> · ${latest.duration_s != null ? `${latest.duration_s}s` : "–"}<br>${esc(latest.run_type)} · finished ${ago(latest.end_date || latest.start_date)}`
        : esc(af.reason || "Airflow metadata not connected")}</div>`;

    const runsBox = $("#runs");
    if (af.available && af.runs?.length) {
      const runs = [...af.runs].reverse(); // oldest → newest, newest on the right
      runsBox.innerHTML = TASKS.map((task) => `
        <span>${TASK_LABEL[task]}</span>
        <div class="lanes">${runs.map((r, i) => {
          const ti = r.tasks.find((x) => x.task_id === task);
          return `<span class="cell ${esc(ti?.state || "none")}" data-run="${i}" data-task="${task}"></span>`;
        }).join("")}</div>`).join("")
        + `<span></span><div class="axis-row"><span>${shortDate(runs[0].game_date)}</span><span>${shortDate(runs[runs.length - 1].game_date)}</span></div>
           <span></span><div class="state-key"><span><i class="cell success"></i>success</span><span><i class="cell skipped"></i>skipped (off day)</span><span><i class="cell failed"></i>failed</span></div>`;
      runsBox.querySelectorAll(".cell[data-run]").forEach((c) => {
        c.addEventListener("mousemove", (e) => {
          const r = runs[+c.dataset.run], ti = r.tasks.find((x) => x.task_id === c.dataset.task);
          const dur = ti?.start_date && ti?.end_date ? `${((new Date(ti.end_date) - new Date(ti.start_date)) / 1000).toFixed(1)}s` : "–";
          showTip(e, `<div class="t-title">${TASK_LABEL[c.dataset.task]} · ${shortDate(r.game_date)}</div>
            ${row("State", esc(ti?.state || "not run"))}${row("Duration", dur)}${row("Try", ti?.try_number ?? "–")}${row("Run", esc(r.run_type))}`);
        });
        c.addEventListener("mouseleave", hideTip);
      });
    } else {
      runsBox.innerHTML = `<div class="runs-empty" style="grid-column:1/-1">Set <code>AIRFLOW_DB_DSN</code> to show DAG runs here. The warehouse panels below still work without it.</div>`;
    }

    const hrs = fresh.hours_since_load, warn = fresh.warn_after_hours || 36;
    const ratio = hrs == null ? 0 : Math.min(1, hrs / warn);
    $("#freshness").innerHTML = `
      <div class="box"><div class="k">Last load</div><div class="v">${hrs == null ? "–" : ago(fresh.last_loaded_at)}</div>
        <div class="meter ${hrs > warn ? "warn" : ""}" title="dbt source freshness warns after ${warn} h"><span style="width:${Math.max(3, ratio * 100)}%"></span></div></div>
      <div class="box"><div class="k">Latest game date</div><div class="v">${shortDate(fresh.last_game_date)}</div>
        <div class="k">${(h.table_counts.find((t) => t.table === "raw.statcast_pitches")?.rows ?? 0).toLocaleString()} raw rows</div></div>`;

    renderRowsChart();
    $("#table-counts").innerHTML = h.table_counts.map((t) => `<li><span>${esc(t.table)}</span><span>${t.rows == null ? "missing" : t.rows.toLocaleString()}</span></li>`).join("");
  }

  function renderRowsChart() {
    const data = state.health.rows_by_date || [], box = $("#rows-chart");
    const { svg, width, height } = svgFor(box);
    if (!data.length) return;
    const m = { l: 2, r: 2, t: 4, b: 16 };
    const max = Math.max(...data.map((d) => d.pitches));
    const bw = (width - m.l - m.r) / data.length;
    const y = scale(0, max, height - m.b, m.t);
    el("line", { class: "zero", x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b }, svg);
    data.forEach((d, i) => {
      const x0 = m.l + i * bw + 1, w = Math.max(2, bw - 2), top = y(d.pitches), base = height - m.b, r = Math.min(4, w / 2);
      const bar = el("path", { class: "bar", d: `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base}Z` }, svg);
      if (i === 0 || i === data.length - 1) el("text", { x: x0 + w / 2, y: height - 3, "text-anchor": "middle" }, svg).textContent = shortDate(d.game_date);
      const hit = el("rect", { class: "hit", x: m.l + i * bw, y: 0, width: bw, height }, svg);
      hit.addEventListener("mousemove", (e) => { bar.style.opacity = 0.8; showTip(e, `<div class="t-title">${shortDate(d.game_date)}</div>${row("Pitches", d.pitches.toLocaleString())}${row("Games", d.games)}`); });
      hit.addEventListener("mouseleave", () => { bar.style.opacity = ""; hideTip(); });
    });
  }

  /* ---------- alerts + leaders ---------- */
  function renderAlerts() {
    const a = state.overview.alerts;
    $("#alerts").innerHTML = a.length
      ? a.map((r) => `<li data-id="${r.pitcher_id}"><span class="ico">${icon.flag}</span>
          <span><div class="who">${esc(displayName(r.pitcher_name))}</div><div class="when">${shortDate(r.game_date)} · ${fmt(r.fb_velo_mph)} mph</div></span>
          <span class="delta">${signed(r.velo_vs_baseline_mph)}</span></li>`).join("")
      : `<li class="empty">${icon.check}No fastball velo drops flagged this season.</li>`;
  }

  function renderLeaders() {
    const rows = state.overview.leaders[state.board] || [];
    const f = {
      velo: (v) => `${fmt(v)} mph`, ride: (v) => `${signed(v)} in`, whiff: (v) => pct(v, 1), consistency: (v) => `${fmt(v, 1)} in`,
    }[state.board];
    const vals = rows.map((r) => Math.abs(r.value));
    const lo = state.board === "consistency" ? 0 : Math.min(...vals) * 0.9, hi = Math.max(...vals);
    $("#leaders").innerHTML = rows.map((r, i) => {
      const w = state.board === "consistency" ? (Math.min(...vals) / Math.abs(r.value)) * 100 : ((Math.abs(r.value) - lo) / (hi - lo || 1)) * 85 + 15;
      return `<li data-id="${r.pitcher_id}"><span class="rank">${i + 1}</span><span class="lname">${esc(displayName(r.pitcher_name))} ${chip(r.pitch_type)}</span><span class="lval">${f(r.value)}</span>
        <span></span><span class="bar-cell"><span style="width:${w.toFixed(0)}%"></span></span></li>`;
    }).join("") || '<li class="muted small">No qualifying pitchers.</li>';
  }

  /* ---------- selection ---------- */
  async function select(id) {
    if (!id) return;
    state.selected = id;
    renderRoster();
    try {
      state.pitcher = await getJSON(`pitcher/${id}.json`);
    } catch (e) {
      toast(`Could not load pitcher ${id}: ${e.message}`);
      return;
    }
    if (state.selected !== id) return;
    try { history.replaceState(null, "", `#p=${id}`); } catch { /* sandboxed */ }
    renderPitcher();
  }
  function renderPitcher() {
    if (!state.pitcher) return;
    renderHero();
    renderMovement();
    renderRelease();
    renderVelo();
    renderArsenal();
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("#roster").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) select(+li.dataset.id); });
    $("#roster").addEventListener("keydown", (e) => {
      const li = e.target.closest("li[data-id]");
      if (!li) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(+li.dataset.id); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
        if (next?.dataset.id) { next.focus(); select(+next.dataset.id); }
      }
    });
    $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderRoster(); });
    $("#hand-filter").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.hand = b.dataset.hand;
      document.querySelectorAll("#hand-filter button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderRoster();
    });
    $("#leader-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.board = b.dataset.board;
      document.querySelectorAll("#leader-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      renderLeaders();
    });
    for (const sel of ["#alerts", "#leaders"]) {
      $(sel).addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) select(+li.dataset.id); });
    }
    $("#pipeline-pill").addEventListener("click", () => document.querySelector(".pipeline").scrollIntoView({ behavior: "smooth", block: "nearest" }));

    const root = document.documentElement;
    let saved = null;
    try { saved = localStorage.getItem("statcast-theme"); } catch { /* storage blocked */ }
    root.dataset.theme = saved || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    $("#theme-toggle").addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("statcast-theme", root.dataset.theme); } catch { /* storage blocked */ }
    });

    let raf;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { renderPitcher(); if (state.health) renderRowsChart(); });
    }).observe($(".charts"));
  }

  async function refreshHealth() {
    try {
      state.health = await getJSON("health.json");
      renderPipeline();
    } catch (e) {
      $("#pipeline-pill").dataset.state = "critical";
      $("#pipeline-pill .label").textContent = "Warehouse unreachable";
      $("#run-summary").innerHTML = `<span class="status-badge critical">${icon.x}error</span><div class="run-meta">${esc(e.message)}</div>`;
    }
  }

  async function boot() {
    wire();
    refreshHealth();
    try {
      state.overview = await getJSON("overview.json");
    } catch (e) {
      $("#hero-name").textContent = "No data yet";
      $("#hero-kicker").textContent = e.message;
      $("#ticker").textContent = "Run the DAG (or make backfill) to build the marts, then reload.";
      return;
    }
    renderTicker();
    renderRoster();
    renderAlerts();
    renderLeaders();
    const fromHash = +(location.hash.match(/p=(\d+)/) || [])[1];
    const first = state.overview.pitchers.find((p) => p.pitcher_id === fromHash) || state.overview.pitchers[0];
    if (first) select(first.pitcher_id);
    setInterval(() => { if (state.health?.mode !== "snapshot") refreshHealth(); }, 60000);
  }

  boot();
})();
