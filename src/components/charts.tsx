"use client";
/**
 * Minimal SVG charts following the dataviz method: one axis, thin marks,
 * recessive grid, legend for >= 2 series + direct end labels, hover layer
 * (crosshair for lines, per-mark tooltip for bars). Text uses ink tokens,
 * never the series colour. Time axis always runs left→right (dir=ltr).
 */
import { useEffect, useRef, useState } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Start small so the first paint never forces the container wider than its parent.
  const [w, setW] = useState(280);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
/** Axis / end labels: compact (25M, 1.2K) so large amounts fit the gutter. */
const fmtShort = (n: number) => (Math.abs(n) >= 10000 ? n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : fmt(n));

export type Series = { key: string; label: string; color: string };
type Point = { label: string; [k: string]: number | string };

function Tooltip({ x, w, title, rows }: { x: number; w: number; title: string; rows: { label: string; value: string; color?: string }[] }) {
  const left = Math.min(Math.max(x + 12, 0), w - 170);
  return (
    <div className="pointer-events-none absolute top-2 z-10 w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left }}>
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-muted">{r.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />}{r.label}</span>
          <span className="font-medium tabular">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export function LineChart({ data, series, height = 220 }: { data: Point[]; series: Series[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 12, r: 64, b: 26, l: 36 };
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const x = (i: number) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 70)));

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden" dir="ltr">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
          {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <svg width={w} height={height} role="img" aria-label={series.map((s) => s.label).join(", ")}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          if (!data.length) return;
          const i = data.length <= 1 ? 0 : Math.round(((px - pad.l) / iw) * (data.length - 1));
          setHover(Math.min(data.length - 1, Math.max(0, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] text-[10px] tabular">{fmtShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => i % every === 0 && (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">{d.label}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={1} />}
        {series.map((s) => {
          const path = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(Number(d[s.key]) || 0)}`).join("");
          const last = data[data.length - 1];
          return (
            <g key={s.key}>
              <path d={path} pathLength={1} className="chart-draw" fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {last && <text x={x(data.length - 1) + 8} y={y(Number(last[s.key]) || 0)} dy="0.32em" className="fill-[var(--text)] text-[11px] font-medium">{fmtShort(Number(last[s.key]) || 0)}</text>}
              {hover !== null && <circle cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} w={w} title={data[hover].label} rows={series.map((s) => ({ label: s.label, value: fmt(Number(data[hover][s.key]) || 0), color: s.color }))} />
      )}
    </div>
  );
}

export function BarChart({ data, valueKey, label, color = "var(--series-1)", height = 200 }: { data: Point[]; valueKey: string; label: string; color?: string; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 12, r: 12, b: 26, l: 36 };
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0)));
  const slot = data.length ? iw / data.length : iw;
  const bw = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 70)));
  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden" dir="ltr">
      <svg width={w} height={height} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y(f * max)} y2={y(f * max)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(f * max)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] text-[10px] tabular">{fmtShort(f * max)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0;
          const cx = pad.l + slot * i + slot / 2;
          const h = Math.max(v ? 2 : 0, ih - (y(v) - pad.t));
          const r = Math.min(4, bw / 2, h);
          const top = pad.t + ih - h;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
              {h > 0 && <path d={`M${cx - bw / 2},${pad.t + ih}V${top + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${pad.t + ih}z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} className="chart-grow" style={{ animationDelay: `${Math.min(i, 20) * 25}ms`, transition: "opacity .2s" }} />}
              {i % every === 0 && <text x={cx} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && <Tooltip x={pad.l + slot * hover} w={w} title={data[hover].label} rows={[{ label, value: fmt(Number(data[hover][valueKey]) || 0) }]} />}
    </div>
  );
}

/** Ranked horizontal bars (top services / staff / branches). */
export function RankBars({ rows, valueLabel, secondary }: { rows: { id: string; name: string; value: number; extra?: string }[]; valueLabel: string; secondary?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">—</p>;
  return (
    <ul className="space-y-3" aria-label={valueLabel}>
      {rows.map((r) => (
        <li key={r.id} className="text-sm" title={`${r.name}: ${fmt(r.value)} ${valueLabel}${r.extra ? ` · ${r.extra}` : ""}`}>
          <div className="mb-1 flex justify-between gap-2"><span className="truncate">{r.name}</span><span className="shrink-0 tabular"><b>{fmt(r.value)}</b>{r.extra && <span className="ms-2 text-xs text-muted">{r.extra}</span>}</span></div>
          <div className="h-2 rounded-full bg-surface-2"><div className="rank-fill h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: "var(--series-1)" }} /></div>
        </li>
      ))}
      {secondary && <li className="text-xs text-muted">{secondary}</li>}
    </ul>
  );
}
