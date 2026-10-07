import { SectionHead } from "@/components/bits";
import { cn } from "@/lib/utils";

const SPORTS = [
  { code: "NFL", name: "NFL Football", status: "live", detail: "Full ensemble: Elo + regression + gradient boosting. Spreads, moneylines, totals, props, live model." },
  { code: "NBA", name: "NBA Basketball", status: "training", detail: "Model in training. Points, rebounds, assists, PRA and 3PM prop markets mapped." },
  { code: "MLB", name: "MLB Baseball", status: "training", detail: "Model in training. Strikeouts, hits, total bases, runs and RBI props mapped." },
  { code: "NHL", name: "NHL Hockey", status: "training", detail: "Model in training. Shots, goals, points and saves props mapped." },
  { code: "NCAAF", name: "NCAA Football", status: "planned", detail: "Architecture-ready. Activates after NFL validation completes." },
  { code: "NCAAB", name: "NCAA Basketball", status: "planned", detail: "Architecture-ready. Shares the NBA feature pipeline." },
  { code: "SOCCER", name: "Soccer (EPL/UCL)", status: "planned", detail: "xG-based projection family. Planned for phase 10." },
  { code: "UFC", name: "UFC / MMA", status: "planned", detail: "Fighter-strength model. Planned for phase 10." },
  { code: "TENNIS", name: "Tennis", status: "planned", detail: "Surface-adjusted Elo. Planned for phase 10." },
  { code: "GOLF", name: "Golf", status: "planned", detail: "Strokes-gained model. Planned for phase 10." },
] as const;

export default function Sports() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Sport coverage"
        sub="One sport, done properly, before ten done badly. The architecture adds new sports without rebuilding the platform."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {SPORTS.map((s) => (
          <div
            key={s.code}
            className={cn(
              "panel rounded-sm p-5",
              s.status === "live" && "border-[#34d399]/40",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="font-mono2 text-sm font-extrabold tracking-[0.12em]">{s.name}</p>
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono2 text-[9px] font-bold tracking-[0.16em]",
                  s.status === "live" && "border-[#34d399]/40 bg-pos-dim text-pos",
                  s.status === "training" && "border-[#fbbf24]/40 bg-warn-dim text-warn",
                  s.status === "planned" && "border-border text-muted-foreground",
                )}
              >
                {s.status === "live" && <span className="led led-pos" />}
                {s.status === "training" && <span className="led led-warn" />}
                {s.status.toUpperCase()}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
            {s.status === "live" && (
              <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 text-center text-[10px]">
                {["ELO", "REGRESSION", "GBM", "ENSEMBLE"].map((m) => (
                  <div key={m} className="bg-secondary px-2 py-1.5 text-pos">{m} ✓</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
