import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PickCard } from "@/components/PickCard";
import { EmptyState, SectionHead } from "@/components/bits";
import { cn } from "@/lib/utils";
import { STATUS_META, type PickStatus } from "@/lib/format";

const FILTERS: Array<{ key: PickStatus | "ALL"; label: string }> = [
  { key: "ALL", label: "ALL" },
  { key: "STRONG_BET", label: "STRONG BET" },
  { key: "BET", label: "BET" },
  { key: "WATCH", label: "WATCH" },
  { key: "HOLD", label: "HOLD" },
  { key: "PASS", label: "PASS" },
];

export default function Picks() {
  const { data, isLoading } = trpc.picks.list.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const [filter, setFilter] = useState<PickStatus | "ALL">("ALL");

  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === "ALL") return all;
    return all.filter((p) => p.version?.status === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: (data ?? []).length };
    for (const p of data ?? []) {
      if (p.version) c[p.version.status] = (c[p.version.status] ?? 0) + 1;
    }
    return c;
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="AI Picks"
        sub="Every pick is versioned. When the market moves, the engine recalculates — and the full timeline stays visible."
      />

      {/* status filter rail */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const meta = f.key !== "ALL" ? STATUS_META[f.key as PickStatus] : null;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex min-h-[44px] items-center gap-2 rounded-sm border px-3 font-mono2 text-[10px] font-bold tracking-[0.14em] transition-colors",
                active
                  ? "border-primary bg-live-dim text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {meta?.dot && <span className={cn("led", meta.dot)} />}
              {f.label}
              <span className="text-muted-foreground/70">{counts[f.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        {isLoading && (
          <div className="panel animate-pulse rounded-sm p-8 text-center font-mono2 text-xs text-muted-foreground">
            LOADING BOARD…
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <EmptyState
            title="No picks in this bucket"
            hint="The engine only issues a position when model probability disagrees with the market price. Check another status or wait for the market to move."
          />
        )}
        {rows.map((row) => (
          <PickCard key={row.pick.id} row={row} />
        ))}
      </div>

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        * A 62% win probability is a prediction — not automatically a bet. Statuses
        reflect the gap between model probability and the current sportsbook price:
        STRONG BET ≥ 90 · BET ≥ 80 · WATCH ≥ 70 · HOLD ≥ 60 · PASS &lt; 60 (AI Edge Score).
      </p>
    </div>
  );
}
