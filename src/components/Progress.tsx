/** Thin progress bar with a numeric label (never colour alone). */
export default function Progress({ used, total, className = "" }: { used: number; total: number; className?: string }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className={`min-w-28 ${className}`} title={`${used} / ${total}`}>
      <div className="mb-1 flex justify-between text-xs tabular"><span>{used} / {total}</span><span className="text-muted">{pct}%</span></div>
      <div className="h-1.5 rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--series-1)" }} />
      </div>
    </div>
  );
}
