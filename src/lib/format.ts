export function fmtOdds(odds: number | null | undefined): string {
  if (odds === null || odds === undefined) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function fmtLine(line: number | string | null | undefined): string {
  if (line === null || line === undefined) return "";
  const n = typeof line === "string" ? parseFloat(line) : line;
  if (Number.isNaN(n)) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

export function pct(x: number | string | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return "—";
  const n = typeof x === "string" ? parseFloat(x) : x;
  if (Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function signedPct(x: number | string | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return "—";
  const n = typeof x === "string" ? parseFloat(x) : x;
  if (Number.isNaN(n)) return "—";
  const v = n * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function timeAgo(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtTime(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  // no timeZone option → the browser's own local zone is used,
  // and timeZoneName labels it so users know the times are theirs
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export type PickStatus = "STRONG_BET" | "BET" | "WATCH" | "HOLD" | "PASS";

export const STATUS_META: Record<
  PickStatus,
  { label: string; cls: string; dot: string; rank: number }
> = {
  STRONG_BET: { label: "STRONG BET", cls: "text-pos bg-pos-dim border border-[#34d399]/40", dot: "led-pos", rank: 0 },
  BET: { label: "BET", cls: "text-live bg-live-dim border border-[#22d3ee]/40", dot: "led-live", rank: 1 },
  WATCH: { label: "WATCH", cls: "text-warn bg-warn-dim border border-[#fbbf24]/40", dot: "led-warn", rank: 2 },
  HOLD: { label: "HOLD", cls: "text-muted-foreground bg-muted border border-border", dot: "", rank: 3 },
  PASS: { label: "PASS", cls: "text-neg bg-neg-dim border border-[#f87171]/40", dot: "led-neg", rank: 4 },
};

export function edgeColor(score: number): string {
  if (score >= 90) return "#34d399";
  if (score >= 80) return "#22d3ee";
  if (score >= 70) return "#fbbf24";
  if (score >= 60) return "#8b93a7";
  return "#f87171";
}

export function num(x: string | number | null | undefined): number {
  if (x === null || x === undefined) return 0;
  return typeof x === "string" ? parseFloat(x) : x;
}
