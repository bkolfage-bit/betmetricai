import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

const LIFECYCLE_STYLE: Record<string, string> = {
  live: "border-[#34d399]/50 bg-pos-dim text-pos",
  shadow: "border-[#38bdf8]/50 bg-[#38bdf8]/10 text-[#38bdf8]",
  collecting: "border-border text-muted-foreground",
};

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
}

/**
 * Market Intelligence dashboard (V2 spec, phase 6).
 * Model A (existing engine) is untouched; Model B (prediction markets) runs per sport;
 * Model C (fusion) starts at weight 0 and only earns influence through forward-tested proof.
 * Every number comes from the stored tables — empty states are shown honestly.
 */
export function MarketIntelPanel() {
  const utils = trpc.useUtils();
  const modelsQ = trpc.marketIntel.sportModels.useQuery();
  const reportQ = trpc.marketIntel.fusionReport.useQuery();
  const logQ = trpc.marketIntel.weightLog.useQuery();
  const boardQ = trpc.marketIntel.shadowBoard.useQuery({ limit: 12 });
  const toggle = trpc.marketIntel.setSportEnabled.useMutation({
    onSuccess: () => utils.marketIntel.sportModels.invalidate(),
  });

  const models = modelsQ.data ?? [];
  const report = reportQ.data?.report ?? [];
  const counts = reportQ.data?.counts ?? null;
  const log = logQ.data ?? [];
  const board = boardQ.data ?? [];
  const liveCount = models.filter((m) => m.lifecycle === "live").length;
  const coveredCount = models.filter((m) => m.hasCoverage).length;

  return (
    <section className="panel overflow-hidden rounded-sm">
      <div className="border-b border-border px-4 py-3">
        <p className="label-caps">Market intelligence — prediction-market fusion (V2)</p>
        <p className="mt-1 max-w-3xl font-mono2 text-[10px] leading-relaxed text-muted-foreground">
          Model A = existing engine (untouched). Model B = prediction-market read per sport. Model C = fusion —
          weight starts at 0 and is only promoted by forward-tested proof (≥100 settled picks, &gt;0.005 Brier
          improvement). Movement is never attributed to news without independent verification, and prediction-market
          volume is never presented as bettor percentages.
        </p>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border font-mono2 sm:grid-cols-4">
        {[
          ["SPORTS TRACKED", `${models.length}`],
          ["PM COVERAGE", `${coveredCount} / ${models.length}`],
          [
            "SHADOW RECORDS",
            counts ? `${counts.settled} settled / ${counts.total}` : "—",
          ],
          ["LIVE FUSION SPORTS", `${liveCount}`],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
            <p className="mt-1 text-sm font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {/* per-sport PM model controls */}
      <div className="border-b border-border">
        <p className="label-caps px-4 pt-3" style={{ fontSize: 8 }}>
          Per-sport prediction-market models — independent enable/disable
        </p>
        <div className="divide-y divide-border">
          {models.length === 0 && (
            <p className="px-4 py-4 font-mono2 text-[10px] text-muted-foreground">
              Loading sport models…
            </p>
          )}
          {models.map((m) => (
            <div
              key={m.sportCode}
              className="flex flex-wrap items-center gap-3 px-4 py-2.5 font-mono2 text-[10px]"
            >
              <span className="w-16 font-bold">{m.sportCode}</span>
              <span
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-[9px] font-bold uppercase",
                  LIFECYCLE_STYLE[m.lifecycle] ?? LIFECYCLE_STYLE.collecting,
                )}
              >
                {m.lifecycle}
              </span>
              <span className="text-muted-foreground">
                {m.hasCoverage ? "PM coverage" : "no PM market — graceful shell"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                weight {(m.fusionWeight * 100).toFixed(1)}% · fwd n={m.forwardSample}
              </span>
              <button
                onClick={() => toggle.mutate({ sportCode: m.sportCode, enabled: !m.enabled })}
                disabled={toggle.isPending}
                className={cn(
                  "ml-auto rounded-sm border px-2 py-0.5 text-[9px] font-bold tracking-[0.1em] disabled:opacity-40",
                  m.enabled
                    ? "border-[#34d399]/50 bg-pos-dim text-pos"
                    : "border-border text-muted-foreground hover:border-primary/50",
                )}
              >
                {m.enabled ? "ENABLED" : "DISABLED"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* recent shadow board — A/B/C probabilities per pick */}
      <div className="border-b border-border">
        <p className="label-caps px-4 pt-3" style={{ fontSize: 8 }}>
          Shadow board — sportsbook-model (A) vs prediction-market (B) vs combined (C) probability
        </p>
        {board.length === 0 ? (
          <p className="px-4 py-4 font-mono2 text-[10px] text-muted-foreground">
            No shadow predictions recorded yet. Recording starts with the next generated picks — existing
            predictions and graded history are untouched.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-3 pt-2">
            <table className="w-full min-w-[720px] font-mono2 text-[10px]">
              <thead>
                <tr className="border-b border-border text-left text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-1.5 pr-3 font-semibold">Pick</th>
                  <th className="py-1.5 pr-3 font-semibold">Sport · market</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">A · engine</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">B · pred. market</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">C · combined</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Weight</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Result</th>
                  <th className="py-1.5 text-right font-semibold">Placed</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="max-w-[180px] truncate py-1.5 pr-3 font-bold">{r.selection}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {r.sportCode} · {r.market}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(r.probA)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.probB === null ? (
                        <span className="text-muted-foreground">— awaiting PM feed</span>
                      ) : (
                        pct(r.probB)
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(r.probC)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {(r.weightUsed * 100).toFixed(1)}%
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {r.outcome === null || r.outcome === undefined ? (
                        <span className="text-muted-foreground">open</span>
                      ) : (
                        <span className={cn("font-bold", r.outcome === 1 ? "text-pos" : "text-neg")}>
                          {r.outcome === 1 ? "WON" : "LOST"}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{timeAgo(r.placedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* A vs B vs C settled forward record */}
      <div className="border-b border-border">
        <p className="label-caps px-4 pt-3" style={{ fontSize: 8 }}>
          Model A vs B vs C — settled forward record (de-duplicated per event/selection)
        </p>
        {report.length === 0 ? (
          <p className="px-4 py-4 font-mono2 text-[10px] text-muted-foreground">
            No settled fusion-shadow records yet. Shadow rows are scored when their picks settle — nothing here
            is backfit on historical data.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-3 pt-2">
            <table className="w-full min-w-[760px] font-mono2 text-[10px]">
              <thead>
                <tr className="border-b border-border text-left text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-1.5 pr-3 font-semibold">Sport · market</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">n</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Brier A</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Brier B</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Brier C</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">LogLoss A</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">LogLoss C</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Win rate</th>
                  <th className="py-1.5 text-right font-semibold">C beats A</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={`${r.sportCode}|${r.market}`} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3 font-bold">
                      {r.sportCode} <span className="font-normal text-muted-foreground">· {r.market}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.c.n}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.a.brier?.toFixed(4) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.b.brier?.toFixed(4) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.c.brier?.toFixed(4) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.a.logLoss?.toFixed(4) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.c.logLoss?.toFixed(4) ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(r.c.winRate)}</td>
                    <td className="py-1.5 text-right">
                      {r.cBeatsA === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : r.cBeatsA ? (
                        <span className="font-bold text-pos">YES</span>
                      ) : (
                        <span className="font-bold text-neg">NO</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* fusion weight change log */}
      <div className="px-4 py-3">
        <p className="label-caps mb-2" style={{ fontSize: 8 }}>
          Fusion weight changes — every move is evidence-logged
        </p>
        {log.length === 0 ? (
          <p className="font-mono2 text-[10px] text-muted-foreground">
            No weight changes yet. The daily learner only moves a weight when it finds ≥100 settled shadow picks
            with a meaningful improvement — and logs the evidence here.
          </p>
        ) : (
          <div className="space-y-1 font-mono2 text-[10px]">
            {log.slice(0, 10).map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="w-16 font-bold">{w.sportCode}</span>
                <span className="tabular-nums">
                  {(w.prevWeight * 100).toFixed(1)}% → {(w.nextWeight * 100).toFixed(1)}%
                </span>
                {w.evidence && (
                  <span className="text-muted-foreground">
                    {w.evidence.decision} · n={w.evidence.forwardSample} · ΔBrier{" "}
                    {typeof w.evidence.improvement === "number"
                      ? w.evidence.improvement.toFixed(4)
                      : "—"}
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">{timeAgo(w.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
