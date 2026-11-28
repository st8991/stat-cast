"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ptClass } from "@/lib/format";

/* ---------- icons ---------- */
export const Icon = {
  flag: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 2 21h20L12 3z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 5 5 9-10" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  dash: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  ),
};

export function Chip({ type }: { type: string }) {
  return (
    <span className="chip">
      <i className={ptClass(type)}></i>
      {type}
    </span>
  );
}

/* ---------- tooltip ---------- */
interface TipApi {
  show: (evt: { clientX: number; clientY: number }, content: ReactNode) => void;
  hide: () => void;
}

const TipContext = createContext<TipApi>({ show: () => {}, hide: () => {} });
export const useTip = () => useContext(TipContext);

export function TipRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="t-row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ content: ReactNode; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback<TipApi["show"]>((evt, content) => {
    setTip({ content, x: evt.clientX, y: evt.clientY });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);

  // Place next to the cursor, flipping away from the viewport edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const pad = 14;
    const r = el.getBoundingClientRect();
    let x = tip.x + pad;
    let y = tip.y + pad;
    if (x + r.width > innerWidth - 8) x = tip.x - r.width - pad;
    if (y + r.height > innerHeight - 8) y = tip.y - r.height - pad;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [tip]);

  return (
    <TipContext.Provider value={api}>
      {children}
      <div className="tooltip" ref={ref} role="tooltip" hidden={!tip}>
        {tip?.content}
      </div>
    </TipContext.Provider>
  );
}

/* ---------- element size ---------- */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return [ref, size] as const;
}
