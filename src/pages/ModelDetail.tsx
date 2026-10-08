import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { SectionHead } from "@/components/bits";
import { num, pct, signedPct } from "@/lib/format";
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
};

const PIPELINE_STEPS = [
  "DATA VALIDATION",
  "FEATURE VALIDATION",
  "TRAINING",
  "BACKTEST",
  "CALIBRATION",
  "VALIDATION",
  "OUT-OF-SAMPLE",
  "HEALTH CHECK",
  "ADMIN REVIEW",
  "PRODUCTION",
] as const;

function ReliabilityChart({
  buckets,
}: {
  buckets: Array<{ p: number; freq: number; n: number }>;
}) {
  const W = 280;
  const H = 220;
  const pad = 26;
  const x = (p: number) => pad + p * (W - pad - 8);
  const y = (f: number) => H - pad - f * (H - pad - 8);
  return (
    <svg width={W} height={H} className="block">
      {/* diagonal = perfect calibration */}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#3f3f46" strokeDasharray="4 3" />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <text x={x(t)} y={H - 8} fontSize={8} fill="#71717a" textAnchor="middle" fontFamily="monospace">
            {t.toFixed(2)}
          </text>
          <text x={10} y={y(t) + 3} fontSize={8} fill="#71717a" textAnchor="middle" fontFamily="monospace">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {buckets.map((b, i) => (
        <g key={i}>
          <circle cx={x(b.p)} cy={y(b.freq)} r={Math.max(3, Math.min(8, b.n / 4))} fill="#34d399" fillOpacity={0.85} />
          <title>{`pred ${(b.p * 100).toFixed(1)}% → actual ${(b.freq * 100).toFixed(1)}% (n=${b.n})`}</title>
        </g>
      ))}
    </svg>
  );
}

export default function ModelDetail() {
  const { modelId = "" } = useParams();
  const { data } = trpc.models.detail.useQuery({ modelId });

  if (!data) {
    return (
      <div className="panel animate-pulse rounded-sm p-10 text-center font-mono2 text-xs text-muted-foreground">
        LOADING MODEL…
      </div>
    );
  }
  const { model, calibration, backtests, health, runtime } = data;
  const bt = backtests[0] ?? null;
  const metrics = model.metrics as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link to="/sports" className="font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground hover:text-pos">
          ← ALL SPORT MODELS
        </Link>
        <SectionHead
          title={`${SPORT_NAMES[model.sportCode] ?? model.sportCode} — ${model.name}`}
          sub={`Model v${model.modelVersion} · feature set ${model.featureVersion} · trained ${model.trainingPeriod} · validated ${model.validationPeriod}`}
        />
      </div>

      {/* status strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 sm:grid-cols-4">
        {[
          ["LIFECYCLE", model.status.toUpperCase()],
          ["HEALTH", health?.status ?? "UNKNOWN"],
          ["SIMS / EVENT", `${(metrics.simsPerEvent as number | undefined)?.toLocaleString() ?? "—"}`],
          ["MARKETS", (runtime?.pickMarkets ?? []).join(" / ").toUpperCase()],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3.5">
            <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
            <p
              className={cn(
                "mt-1 text-sm font-bold",
                v === "HEALTHY" && "text-pos",
                v === "WARNING" && "text-warn",
                (v === "DEGRADED" || v === "DISABLED") && "text-neg",
              )}
            >
              {v}
            </p>
          </div>
        ))}
      </div>

      {/* production validation pipeline */}
      <section className="panel rounded-sm p-5">
        <p className="label-caps mb-4">Production validation pipeline — no model ships without every gate</p>
        <div className="flex flex-wrap items-center gap-1.5 font-mono2 text-[9px] font-bold tracking-[0.1em]">
          {PIPELINE_STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded-sm border px-2 py-1",
                  i < PIPELINE_STEPS.length - 1
                    ? "border-[#34d399]/40 bg-pos-dim text-pos"
                    : model.status === "production"
                      ? "border-[#34d399]/40 bg-pos-dim text-pos"
                      : "border-border text-muted-foreground",
                )}
              >
                {s} ✓
              </span>
              {i < PIPELINE_STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono2 text-[10px] text-muted-foreground">
          Retrained models enter as CANDIDATE and require admin review — nothing auto-deploys.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ensemble components */}
        <section className="panel rounded-sm p-5">
          <p className="label-caps mb-4">Ensemble components — weights fit on chronological validation</p>
          <div className="flex flex-col gap-2.5">
            {model.components.map((c) => (
              <div key={c.name}>
                <div className="mb-1 flex items-center justify-between font-mono2 text-[10px]">
                  <span className="font-bold tracking-[0.1em]">{c.name.toUpperCase()}</span>
                  <span className="tabular-nums text-muted-foreground">{pct(c.weight, 0)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-secondary">
                  <div className="h-full bg-[#34d399]" style={{ width: `${c.weight * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          {runtime && (
            <p className="mt-4 font-mono2 text-[10px] leading-relaxed text-muted-foreground">
              Live model: {runtime.live.gameMinutes}min regulation · margin SD {runtime.live.marginSd} · total SD {runtime.live.totalSd}
            </p>
          )}
        </section>

        {/* health checks */}
        <section className="panel rounded-sm p-5">
          <p className="label-caps mb-4">Model health monitoring</p>
          {health ? (
            <div className="flex flex-col gap-2">
              {health.checks.map((c) => (
                <div key={c.name} className="flex items-start justify-between gap-3 rounded-sm border border-border px-3 py-2">
                  <div>
                    <p className="font-mono2 text-[11px] font-bold">{c.name}</p>
                    <p className="font-mono2 text-[10px] text-muted-foreground">{c.detail}</p>
                  </div>
                  <span className={cn("font-mono2 text-[10px] font-bold", c.ok ? "text-pos" : "text-warn")}>
                    {c.ok ? "PASS" : "CHECK"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono2 text-xs text-muted-foreground">No health checks recorded yet.</p>
          )}
        </section>
      </div>

      {/* calibration */}
      <section className="panel rounded-sm p-5">
        <p className="label-caps mb-1">Probability calibration — measured on graded out-of-sample picks</p>
        <p className="mb-4 font-mono2 text-[10px] text-muted-foreground">
          Points on the diagonal are perfectly calibrated. Bubbles sized by sample count.
        </p>
        {calibration.length === 0 ? (
          <p className="rounded-sm border border-border p-6 text-center font-mono2 text-xs font-bold tracking-[0.12em] text-warn">
            INSUFFICIENT HISTORICAL DATA
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {calibration.map((c) => (
              <div key={`${c.market}-${c.id}`} className="rounded-sm border border-border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono2 text-[11px] font-bold tracking-[0.12em]">{c.market.toUpperCase()}</p>
                  <p className="font-mono2 text-[10px] text-muted-foreground">n={c.sampleSize}</p>
                </div>
                <ReliabilityChart buckets={c.buckets} />
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border text-center font-mono2 text-[10px]">
                  <div className="bg-secondary px-1 py-1.5">
                    <p className="text-muted-foreground">BRIER</p>
                    <p className="font-bold tabular-nums">{num(c.brier).toFixed(3)}</p>
                  </div>
                  <div className="bg-secondary px-1 py-1.5">
                    <p className="text-muted-foreground">LOGLOSS</p>
                    <p className="font-bold tabular-nums">{num(c.logLoss).toFixed(3)}</p>
                  </div>
                  <div className="bg-secondary px-1 py-1.5">
                    <p className="text-muted-foreground">ECE</p>
                    <p className={cn("font-bold tabular-nums", num(c.ece) < 0.06 ? "text-pos" : "text-warn")}>
                      {num(c.ece).toFixed(3)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* backtest */}
      <section className="panel overflow-hidden rounded-sm">
        <p className="label-caps border-b border-border px-4 py-3">
          Backtest — strict chronological out-of-sample ({bt?.testWindow ?? "—"})
        </p>
        {!bt ? (
          <p className="p-6 text-center font-mono2 text-xs font-bold tracking-[0.12em] text-warn">
            INSUFFICIENT HISTORICAL DATA
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-px bg-border font-mono2 sm:grid-cols-6 lg:grid-cols-9">
              {[
                ["PICKS", `${bt.picks}`],
                ["RECORD", `${bt.wins}-${bt.losses}-${bt.pushes}`],
                ["WIN%", pct(bt.winRate)],
                ["ROI", signedPct(bt.roi)],
                ["UNITS", `${num(bt.units) >= 0 ? "+" : ""}${num(bt.units).toFixed(1)}`],
                ["AVG CLV", `${num(bt.avgClv).toFixed(2)}%`],
                ["BRIER", num(bt.brier).toFixed(3)],
                ["MAX DD", `${num(bt.maxDrawdown).toFixed(1)}u`],
                ["AVG ODDS", `${bt.avgOdds > 0 ? "+" : ""}${bt.avgOdds}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-card px-3 py-3">
                  <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
                  <p className="mt-1 text-xs font-bold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            <table className="w-full border-collapse font-mono2 text-xs">
              <thead>
                <tr className="border-y border-border text-left">
                  {["EDGE BAND", "PICKS", "WIN%", "ROI"].map((h) => (
                    <th key={h} className="label-caps px-4 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bt.byEdge.map((b) => (
                  <tr key={b.band} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-bold">Edge {b.band}</td>
                    <td className="px-4 py-2.5 tabular-nums">{b.picks}</td>
                    <td className="px-4 py-2.5 tabular-nums">{pct(b.winRate, 0)}</td>
                    <td className={cn("px-4 py-2.5 tabular-nums", b.roi >= 0 ? "text-pos" : "text-neg")}>
                      {signedPct(b.roi)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        * Trained and validated via the real pipeline. Backtests are strictly
        chronological — no future information reaches training. Past performance never guarantees
        future results.
      </p>
    </div>
  );
}
