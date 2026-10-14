import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PickCard, selectionLabel } from "@/components/PickCard";
import { SaveButton } from "@/components/SaveButton";
import { EmptyState, SectionHead } from "@/components/bits";
import { fmtLine, fmtOdds, fmtTime, signedPct, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CircleCheck, CircleMinus, CircleX, Heart } from "lucide-react";
import type { RouterOutputs } from "@contracts/router-types";

type SavedRow = RouterOutputs["saved"]["list"]["upcoming"][number];

const RESULT_STYLE = {
  won: { icon: CircleCheck, cls: "text-pos border-[#34d399]/40 bg-pos-dim", label: "WON" },
  lost: { icon: CircleX, cls: "text-neg border-[#f87171]/40 bg-neg-dim", label: "LOST" },
  push: { icon: CircleMinus, cls: "text-muted-foreground border-border bg-secondary", label: "PUSH" },
} as const;

function SettledCard({ row }: { row: SavedRow }) {
  const g = row.grade;
  const meta = g ? RESULT_STYLE[g.result] : null;
  const Icon = meta?.icon ?? CircleMinus;
  return (
    <div className="panel flex items-center gap-3 rounded-sm px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.sportCode} <span className="text-muted-foreground/50">/</span> {row.pick.market}
          <span className="text-muted-foreground/50"> / </span>
          {fmtTime(row.event.startTime)}
        </p>
        <p className="mt-0.5 truncate text-sm font-bold tracking-tight">
          {row.away && row.home ? selectionLabel(row as never) : "—"}
        </p>
        <p className="mt-0.5 font-mono2 text-[10px] text-muted-foreground">
          {row.away?.abbr} @ {row.home?.abbr} · graded {fmtOdds(row.version?.odds ?? 0)}
          {row.version?.line != null && <> {fmtLine(row.version.line)}</>}
          {" · saved "}{row.savedAt ? timeAgo(row.savedAt) : ""}
        </p>
      </div>
      {meta && g && (
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right font-mono2">
            <span className={cn("flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-bold tracking-[0.14em]", meta.cls)}>
              <Icon className="h-3.5 w-3.5" /> {meta.label}
            </span>
            <p className={cn("mt-1 text-[10px] tabular-nums", parseFloat(g.units) >= 0 ? "text-pos" : "text-neg")}>
              {parseFloat(g.units) >= 0 ? "+" : ""}{parseFloat(g.units).toFixed(2)}u
              {" · "}
              {parseFloat(g.clv) >= 0
                ? `beat the close by ${signedPct(parseFloat(g.clv) / 100).replace("+", "")}`
                : `missed the close by ${signedPct(parseFloat(g.clv) / 100).replace("-", "")}`}
            </p>
          </div>
          <SaveButton pickId={row.pick.id} />
        </div>
      )}
    </div>
  );
}

export default function Saved() {
  const { user, isLoading } = useAuth();
  const { data, isLoading: loading } = trpc.saved.list.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30_000,
  });

  if (!isLoading && !user) {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <Heart className="mx-auto h-8 w-8 text-[#f472b6]" />
        <h2 className="mt-4 text-2xl font-extrabold">SIGN IN TO SAVE PICKS</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Tap the heart on any pick to build your personal watchlist — saved picks live here,
          update with the market, and show their graded result when the game ends.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-block rounded-sm bg-primary px-8 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground"
        >
          SIGN IN / REGISTER
        </Link>
      </div>
    );
  }

  const upcoming = data?.upcoming ?? [];
  const settled = (data?.settled ?? []).filter((r) => r.grade);

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Saved picks"
        sub="Your personal watchlist. Tap the heart on any pick anywhere on the site to save it — prices, versions and status update live here, and settled picks show their graded result."
      />

      {loading && (
        <div className="panel animate-pulse rounded-sm p-8 text-center font-mono2 text-xs text-muted-foreground">
          LOADING YOUR LIST…
        </div>
      )}

      {!loading && upcoming.length === 0 && settled.length === 0 && (
        <EmptyState
          title="No saved picks yet"
          hint="Tap the heart on the right side of any pick card — on the Picks board, +EV page, Live page or Home — and it lands here."
        />
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="label-caps">Upcoming & live — {upcoming.length}</p>
          {upcoming.map((row) => (
            <PickCard key={row.pick.id} row={row as never} />
          ))}
        </section>
      )}

      {settled.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="label-caps">Settled — graded, never restated</p>
          {settled.map((row) => (
            <SettledCard key={row.pick.id} row={row} />
          ))}
        </section>
      )}

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        Saved picks follow the pick, not a single version — when the engine re-prices a
        position, your saved card shows the latest version. Graded results come straight
        from the immutable pick history.
      </p>
    </div>
  );
}
