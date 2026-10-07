import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { cn } from "@/lib/utils";

/**
 * Global sport filter rail — toggle sports off to remove them across the
 * whole terminal (picks, +EV, live, props, parlays, performance, ticker).
 * The selection persists in localStorage.
 */
export function SportFilter({ compact = false }: { compact?: boolean }) {
  const { data } = trpc.models.sports.useQuery();
  const { hidden, allVisible, toggle, showAll } = useSportFilter();
  const codes = (data ?? []).map((s) => s.code);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span
        className={cn(
          "shrink-0 font-mono2 font-bold tracking-[0.14em] text-muted-foreground",
          compact ? "text-[8px]" : "text-[9px]",
        )}
      >
        SPORTS
      </span>
      <button
        onClick={showAll}
        className={cn(
          "shrink-0 rounded-sm border px-2.5 py-1 font-mono2 text-[10px] font-bold tracking-[0.12em] transition-colors",
          allVisible
            ? "border-[#34d399]/50 bg-pos-dim text-pos"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        ALL
      </button>
      {codes.map((c) => {
        const off = hidden.includes(c);
        return (
          <button
            key={c}
            onClick={() => toggle(c)}
            title={off ? `Show ${c}` : `Hide ${c} everywhere`}
            className={cn(
              "shrink-0 rounded-sm border px-2.5 py-1 font-mono2 text-[10px] font-bold tracking-[0.12em] transition-colors",
              off
                ? "border-border/60 text-muted-foreground/40 line-through decoration-muted-foreground/50 hover:text-muted-foreground"
                : "border-border text-foreground/85 hover:border-[#34d399]/40 hover:text-pos",
            )}
          >
            {c}
          </button>
        );
      })}
      {!allVisible && (
        <span className="shrink-0 font-mono2 text-[9px] tracking-[0.1em] text-warn">
          {hidden.length} HIDDEN
        </span>
      )}
    </div>
  );
}
