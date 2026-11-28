"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, signed } from "@/lib/format";
import type { Board, Health, Overview, PitcherDetail } from "@/lib/types";
import { MovementChart, ReleaseChart, VeloChart } from "./charts";
import { Alerts, ArsenalTable, Hero, Leaders, Pipeline, PipelinePill, Roster, Ticker, type HandFilter } from "./panels";
import { TooltipProvider } from "./ui";

const API = "/api/";
const HEALTH_REFRESH_MS = 60_000;

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { cache: "no-store" });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PitcherDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hand, setHand] = useState<HandFilter>("");
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState<Board>("velo");
  const [hoverType, setHoverType] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const selectedRef = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const select = useCallback(
    async (id: number) => {
      if (!id) return;
      selectedRef.current = id;
      setSelected(id);
      let d: PitcherDetail;
      try {
        d = await getJSON<PitcherDetail>(`pitcher/${id}.json`);
      } catch (e) {
        showToast(`Could not load pitcher ${id}: ${(e as Error).message}`);
        return;
      }
      if (selectedRef.current !== id) return; // a newer click won
      try {
        history.replaceState(null, "", `#p=${id}`);
      } catch {
        /* sandboxed */
      }
      setHoverType(null);
      setDetail(d);
    },
    [showToast],
  );

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getJSON<Health>("health.json"));
      setHealthError(null);
    } catch (e) {
      setHealthError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, HEALTH_REFRESH_MS);
    getJSON<Overview>("overview.json")
      .then((ov) => {
        setOverview(ov);
        const fromHash = Number((location.hash.match(/p=(\d+)/) || [])[1]);
        const first = ov.pitchers.find((p) => p.pitcher_id === fromHash) || ov.pitchers[0];
        if (first) select(first.pitcher_id);
      })
      .catch((e: Error) => setOverviewError(e.message));
    return () => clearInterval(timer);
  }, [refreshHealth, select]);

  const toggleTheme = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("statcast-theme", root.dataset.theme);
    } catch {
      /* storage blocked */
    }
  };

  return (
    <TooltipProvider>
      <div className="bg" aria-hidden="true">
        <div className="glow g1"></div>
        <div className="glow g2"></div>
        <div className="glow g3"></div>
        <div className="grain"></div>
      </div>

      <header className="topbar glass">
        <div className="brand">
          <svg className="ball" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="14" />
            <path d="M9 5c4 6 4 16 0 22M23 5c-4 6-4 16 0 22" />
          </svg>
          <span className="wordmark">
            stat<span>·</span>cast
          </span>
        </div>
        <Ticker overview={overview} error={overviewError} />
        <div className="top-actions">
          <PipelinePill
            health={health}
            error={healthError}
            onClick={() => document.getElementById("pipeline")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
          />
          <button className="icon-btn" type="button" aria-label="Toggle light or dark theme" onClick={toggleTheme}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="layout">
        <Roster
          pitchers={overview?.pitchers ?? []}
          selected={selected}
          hand={hand}
          query={query}
          onHand={setHand}
          onQuery={setQuery}
          onSelect={select}
        />

        <section className="focus">
          <Hero detail={detail} error={overviewError} />

          <div className="charts">
            <figure className="panel glass chart movement">
              <figcaption className="panel-head">
                <div>
                  <h2>Pitch movement</h2>
                  <p className="muted small">
                    Induced vertical break vs arm-side break, inches. ◇ = league average for that pitch type and hand.
                  </p>
                </div>
              </figcaption>
              {detail ? (
                <MovementChart detail={detail} hoverType={hoverType} onHover={setHoverType} />
              ) : (
                <>
                  <div className="chart-body"></div>
                  <div className="legend"></div>
                </>
              )}
            </figure>

            <div className="chart-stack">
              <figure className="panel glass chart">
                <figcaption className="panel-head">
                  <div>
                    <h2>Release point</h2>
                    <p className="muted small">Catcher&apos;s view, feet. Fixed ±9 in window, 3 in grid. Ring = 1 SD release cloud.</p>
                  </div>
                  <div className="stat-inline">
                    {detail?.release && (
                      <>
                        <b>{fmt(detail.release.release_spread_in, 1)} in</b>spread · lg {fmt(detail.league_release?.avg_release_spread_in, 1)}
                      </>
                    )}
                  </div>
                </figcaption>
                {detail ? <ReleaseChart detail={detail} hoverType={hoverType} /> : <div className="chart-body"></div>}
              </figure>
              <figure className="panel glass chart">
                <figcaption className="panel-head">
                  <div>
                    <h2>Fastball velo by game</h2>
                    <p className="muted small">Avg FF/SI/FC velo, mph. Dashed = average of prior games.</p>
                  </div>
                  <VeloStat detail={detail} />
                </figcaption>
                {detail ? <VeloChart trends={detail.trends} /> : <div className="chart-body"></div>}
              </figure>
            </div>
          </div>

          <div className="panel glass arsenal">
            <div className="panel-head">
              <h2>Arsenal</h2>
              <span className="muted small">Season to date · differences vs league average for the same pitch type and hand</span>
            </div>
            <div className="table-wrap">
              {detail ? <ArsenalTable arsenal={detail.arsenal} hoverType={hoverType} onHover={setHoverType} /> : <table></table>}
            </div>
          </div>
        </section>

        <aside className="side">
          <Pipeline health={health} error={healthError} />
          <Alerts overview={overview} onSelect={select} />
          <Leaders overview={overview} board={board} onBoard={setBoard} onSelect={select} />
        </aside>
      </main>

      <div className="toast" hidden={!toast}>
        {toast}
      </div>
    </TooltipProvider>
  );
}

function VeloStat({ detail }: { detail: PitcherDetail | null }) {
  const last = detail?.trends.at(-1);
  if (!last) return <div className="stat-inline"></div>;
  const vs = last.velo_vs_baseline_mph;
  return (
    <div className="stat-inline">
      <b>{fmt(last.fb_velo_mph)} mph</b>last game {vs != null && <span className={vs >= 0 ? "up" : "down"}>{signed(vs)}</span>}
    </div>
  );
}
