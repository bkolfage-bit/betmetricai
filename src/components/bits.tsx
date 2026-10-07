import { useEffect, useState } from "react";
import { edgeColor, STATUS_META, timeAgo, type PickStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: PickStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono2 text-[10px] font-bold tracking-[0.14em]",
        meta.cls,
        className,
      )}
    >
      {meta.dot && <span className={cn("led", meta.dot)} />}
      {meta.label}
    </span>
  );
}

/** 0–100 AI Edge gauge with threshold ticks. */
export function EdgeGauge({ score, showValue = true }: { score: number; showValue?: boolean }) {
  const color = edgeColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
        {/* threshold ticks */}
        {[60, 70, 80, 90].map((t) => (
          <div key={t} className="absolute inset-y-0 w-px bg-background/70" style={{ left: `${t}%` }} />
        ))}
      </div>
      {showValue && (
        <span className="font-mono2 text-sm font-bold tabular-nums" style={{ color }}>
          {score}
        </span>
      )}
    </div>
  );
}

/** Circular edge score dial for hero / best-bet display. */
export function EdgeDial({ score, size = 120 }: { score: number; size?: number }) {
  const color = edgeColor(score);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono2 font-extrabold tabular-nums" style={{ color, fontSize: size * 0.26 }}>
          {score}
        </span>
        <span className="label-caps" style={{ fontSize: 8 }}>AI EDGE</span>
      </div>
    </div>
  );
}

/**
 * Data freshness: the LED reflects the FEED's age (never pretend stale
 * data is live); the text can show the age of the specific item.
 */
export function Freshness({
  at,
  live = false,
  text,
}: {
  at: Date | string | null | undefined;
  live?: boolean;
  text?: string;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const d = at ? (typeof at === "string" ? new Date(at) : at) : null;
  const ageSec = d ? (Date.now() - d.getTime()) / 1000 : Infinity;
  const stale = ageSec > 150;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono2 text-[10px] uppercase tracking-[0.14em]">
      {stale ? (
        <>
          <span className="led led-neg" />
          <span className="text-neg">Data delayed</span>
        </>
      ) : (
        <>
          <span className={cn("led", live ? "led-live" : "led-pos")} />
          <span className={live ? "text-live" : "text-pos"}>{live ? "Live" : "Fresh"}</span>
          <span className="text-muted-foreground">· {text ?? `updated ${timeAgo(d)}`}</span>
        </>
      )}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-[#fbbf24]/40 bg-warn-dim px-2 py-0.5 font-mono2 text-[9px] font-bold uppercase tracking-[0.18em] text-warn">
      Demo data
    </span>
  );
}

export function Sparkline({
  points,
  width = 120,
  height = 32,
  color = "#22d3ee",
  baseline,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  baseline?: number;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points, baseline ?? Infinity);
  const max = Math.max(...points, baseline ?? -Infinity);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const y = (p: number) => height - ((p - min) / span) * (height - 4) - 2;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={area} fill={color} opacity={0.08} />
      {baseline !== undefined && baseline >= min && baseline <= max && (
        <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="3 3" />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={width} cy={y(points[points.length - 1])} r={2} fill={color} />
    </svg>
  );
}

export function SectionHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-mono2 text-xs font-bold uppercase tracking-[0.22em] text-foreground">
          <span className="mr-2 inline-block h-2 w-2 bg-primary" />
          {title}
        </h2>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border py-12 text-center">
      <p className="font-mono2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
