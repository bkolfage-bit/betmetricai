import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { PickCard } from "@/components/PickCard";
import { useSportFilter } from "@/providers/sport-filter";
import { EmptyState, SectionHead } from "@/components/bits";
import { cn } from "@/lib/utils";
import { STATUS_META, type PickStatus } from "@/lib/format";
import { Lock, Sparkles } from "lucide-react";

const FILTERS: Array<{ key: PickStatus | "ALL"; label: string }> = [
  { key: "ALL", label: "ALL" },
  { key: "STRONG_BET", label: "STRONG BET" },
  { key: "BET", label: "BET" },
  { key: "WATCH", label: "WATCH" },
  { key: "HOLD", label: "HOLD" },
  { key: "PASS", label: "PASS" },
];

export default function Picks() {
  const { sport } = useSportFilter();
  const { data, isLoading } = trpc.picks.list.useQuery(
    sport ? { sport } : undefined,
    { refetchInterval: 15000 },
  );
  const [filter, setFilter] = useState<PickStatus | "ALL">("ALL");

  const rows = useMemo(() => {
    const all = data?.picks ?? [];
    if (filter === "ALL") return all;
    return all.filter((p) => p.version?.status === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: (data?.picks ?? []).length };
    for (const p of data?.picks ?? []) {
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

      {!isLoading && (data?.lockedCount ?? 0) > 0 && (
        <Link
          to="/premium"
          className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-[#fbbf24]/40 bg-warn-dim px-5 py-4 transition-colors hover:border-[#fbbf24]/70"
        >
          <div className="flex items-center gap-3">
            <Lock className="h-4 w-4 text-warn" />
            <p className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{data!.lockedCount} more pick{data!.lockedCount === 1 ? "" : "s"}</span>{" "}
              hidden on the FREE plan — including every AI Edge above 90.
            </p>
          </div>
          <span className="flex items-center gap-1.5 font-mono2 text-[10px] font-bold tracking-[0.14em] text-warn">
            <Sparkles className="h-3.5 w-3.5" /> UNLOCK WITH PRO
          </span>
        </Link>
      )}

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        * A 62% win probability is a prediction — not automatically a bet. Statuses
        reflect the gap between model probability and the current sportsbook price:
        STRONG BET ≥ 90 · BET ≥ 80 · WATCH ≥ 70 · HOLD ≥ 60 · PASS &lt; 60 (AI Edge Score).
      </p>
    </div>
  );
}
