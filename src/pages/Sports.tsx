import { Link } from "react-router";
import { SectionHead } from "@/components/bits";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";

const SPORT_NAMES: Record<string, string> = {
  NFL: "NFL Football",
  NBA: "NBA Basketball",
  MLB: "MLB Baseball",
  NHL: "NHL Hockey",
  NCAAF: "NCAA Football",
  NCAAB: "NCAA Basketball",
  SOCCER: "Soccer",
  TENNIS: "Tennis",
  GOLF: "Golf",
  UFC: "UFC / MMA",
  MOTORSPORTS: "Motorsports",
};

function HealthBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono2 text-[9px] font-bold tracking-[0.16em]",
        status === "HEALTHY" && "border-[#34d399]/40 bg-pos-dim text-pos",
        status === "WARNING" && "border-[#fbbf24]/40 bg-warn-dim text-warn",
        status === "DEGRADED" && "border-[#fb923c]/40 bg-neg-dim text-[#fb923c]",
        status === "DISABLED" && "border-border text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "led",
          status === "HEALTHY" && "led-pos",
          status === "WARNING" && "led-warn",
          (status === "DEGRADED" || status === "DISABLED") && "led-neg",
        )}
      />
      {status}
    </span>
  );
}

export default function Sports() {
  const { data } = trpc.models.list.useQuery();

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Sport coverage"
        sub="Eleven sport-specific quantitative models — each with its own features, ensemble weights, calibration and backtests. Select a model for full detail."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((m) => (
          <Link
            key={m.modelId}
            to={`/sports/${encodeURIComponent(m.modelId)}`}
            className="panel rounded-sm p-5 transition-colors hover:border-[#34d399]/40"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono2 text-sm font-extrabold tracking-[0.12em]">
                {SPORT_NAMES[m.sportCode] ?? m.sportCode}
              </p>
              <HealthBadge status={m.healthStatus} />
            </div>
            <p className="mt-1 font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground">
              {m.name} · v{m.modelVersion} · features {m.featureVersion}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 text-center text-[10px]">
              {m.components.slice(0, 4).map((c) => (
                <div key={c.name} className="bg-secondary px-2 py-1.5">
                  <span className="text-pos">{c.name.toUpperCase()}</span>{" "}
                  <span className="text-muted-foreground">{Math.round(c.weight * 100)}%</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between font-mono2 text-[10px] tracking-[0.12em] text-muted-foreground">
              <span>
                {m.pickMarkets.join(" · ").toUpperCase() || "MONEYLINE"}
              </span>
              <span>{m.simsPerEvent.toLocaleString()} SIMS</span>
            </div>
          </Link>
        ))}
      </div>
      <p className="font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground">
        MODEL WEIGHTS ARE OPTIMIZED ON CHRONOLOGICAL VALIDATION DATA. DEMO DATASET — NOT BETTING ADVICE.
      </p>
    </div>
  );
}
