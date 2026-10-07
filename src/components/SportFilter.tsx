import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";

/**
 * Global single-sport selector — the big "VIEWING" control in the header.
 * Pick a sport and the entire terminal (picks, +EV, live, props, parlays,
 * line movement, performance, ticker, tracker) shows only that sport.
 * Persisted in localStorage.
 */
export function SportFilter() {
  const { data } = trpc.models.sports.useQuery();
  const { sport, setSport } = useSportFilter();
  const codes = (data ?? []).map((s) => s.code);

  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono2 text-[9px] font-bold tracking-[0.18em] text-muted-foreground sm:inline">
        VIEWING
      </span>
      <div className="relative">
        <select
          value={sport ?? "ALL"}
          onChange={(e) => setSport(e.target.value === "ALL" ? null : e.target.value)}
          aria-label="Filter the whole site to one sport"
          className={cn(
            "min-h-[36px] max-w-[132px] cursor-pointer appearance-none rounded-sm border pl-2.5 pr-7 font-mono2 text-[10px] font-bold tracking-[0.08em] outline-none transition-colors sm:max-w-none sm:pl-3 sm:pr-8 sm:text-[11px] sm:tracking-[0.12em]",
            sport
              ? "border-[#34d399]/60 bg-pos-dim text-pos"
              : "border-border bg-card text-foreground hover:border-primary/40",
          )}
        >
          <option value="ALL">ALL SPORTS</option>
          {codes.map((c) => (
            <option key={c} value={c}>
              {c} ONLY
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
      {sport && (
        <button
          onClick={() => setSport(null)}
          title="Show all sports"
          className="flex min-h-[36px] items-center gap-1 rounded-sm border border-border px-2 font-mono2 text-[10px] font-bold tracking-[0.1em] text-muted-foreground transition-colors hover:border-[#34d399]/40 hover:text-pos"
        >
          <X className="h-3 w-3" /> CLEAR
        </button>
      )}
    </div>
  );
}
