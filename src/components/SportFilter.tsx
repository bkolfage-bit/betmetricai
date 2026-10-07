import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";

/**
 * Sport filter rail — shared by Picks, +EV, Line Movement and Performance.
 * `null` = all sports.
 */
export function SportFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (sport: string | null) => void;
}) {
  const { data } = trpc.models.sports.useQuery();
  const codes = (data ?? []).map((s) => s.code);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onChange(null)}
        className={cn(
          "rounded-sm border px-2.5 py-1 font-mono2 text-[10px] font-bold tracking-[0.12em] transition-colors",
          value === null
            ? "border-[#34d399]/50 bg-pos-dim text-pos"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        ALL
      </button>
      {codes.map((c) => (
        <button
          key={c}
          onClick={() => onChange(value === c ? null : c)}
          className={cn(
            "rounded-sm border px-2.5 py-1 font-mono2 text-[10px] font-bold tracking-[0.12em] transition-colors",
            value === c
              ? "border-[#34d399]/50 bg-pos-dim text-pos"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
