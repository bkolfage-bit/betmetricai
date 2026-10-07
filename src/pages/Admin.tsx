import { useEffect, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { SectionHead } from "@/components/bits";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";

export default function Admin() {
  const { user, isLoading } = useAuth();
  const { data, refetch } = trpc.admin.stats.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 20000,
  });
  const updateThresholds = trpc.admin.updateThresholds.useMutation({
    onSuccess: () => refetch(),
  });
  const updateBook = trpc.admin.updateBook.useMutation({
    onSuccess: () => refetch(),
  });
  const [th, setTh] = useState({ strongBet: 90, bet: 80, watch: 70, hold: 60, minEv: 0.01 });

  useEffect(() => {
    if (data?.thresholds) setTh(data.thresholds);
  }, [data?.thresholds]);

  if (!isLoading && user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <Shield className="mx-auto h-8 w-8 text-warn" />
        <h2 className="mt-4 text-2xl font-extrabold">ADMIN ACCESS REQUIRED</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          This console is restricted to platform administrators.
        </p>
        <Link to="/" className="mt-6 inline-block font-mono2 text-xs text-primary hover:underline">
          ← BACK TO TERMINAL
        </Link>
      </div>
    );
  }
  if (!data) return null;

  const tickAge = data.lastTick ? (Date.now() - new Date(data.lastTick).getTime()) / 1000 : Infinity;
  const feedOk = tickAge < 120;

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Admin console"
        sub="Platform health, model controls and sportsbook management — no source-code changes required."
      />

      {/* health cards */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 sm:grid-cols-4">
        {[
          ["TOTAL USERS", `${data.users.total}`],
          ["PRO USERS", `${data.users.pro}`],
          ["FREE USERS", `${data.users.free}`],
          ["ADMINS", `${data.users.admins}`],
        ].map(([k, val]) => (
          <div key={k} className="bg-card px-4 py-3.5">
            <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{val}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* feed status */}
        <section className="panel rounded-sm p-5">
          <p className="label-caps mb-4">Feed & model status</p>
          <div className="space-y-3 font-mono2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ODDS FEED (DEMO SIMULATOR)</span>
              <span className={cn("flex items-center gap-2 font-bold", feedOk ? "text-pos" : "text-neg")}>
                <span className={cn("led", feedOk ? "led-pos" : "led-neg")} />
                {feedOk ? `HEALTHY · ticked ${timeAgo(data.lastTick)}` : "STALLED"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">DATA MODE</span>
              <span className="font-bold text-warn">DEMO — SIMULATED DATA</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">MODEL</span>
              <span>nfl-ensemble-v1.3 (Elo + regression + GBM)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">STRIPE</span>
              <span className="text-muted-foreground">NOT CONNECTED — awaiting keys</span>
            </div>
            <div className="border-t border-border pt-3">
              <p className="label-caps mb-2" style={{ fontSize: 8 }}>Sport model coverage</p>
              <div className="flex flex-wrap gap-1.5">
                {data.sports.map((s) => (
                  <span
                    key={s.id}
                    className={cn(
                      "rounded-sm border px-2 py-1 text-[10px] font-bold",
                      s.modelStatus === "live" && "border-[#34d399]/40 text-pos",
                      s.modelStatus === "training" && "border-[#fbbf24]/40 text-warn",
                      s.modelStatus === "planned" && "border-border text-muted-foreground",
                    )}
                  >
                    {s.code} · {s.modelStatus.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* thresholds */}
        <section className="panel rounded-sm p-5">
          <p className="label-caps mb-1">AI Edge thresholds</p>
          <p className="mb-4 text-[11px] text-muted-foreground">
            Changes re-evaluate every active pick immediately (versioned, never overwritten).
          </p>
          <div className="space-y-3">
            {(
              [
                ["STRONG_BET ≥", "strongBet"],
                ["BET ≥", "bet"],
                ["WATCH ≥", "watch"],
                ["HOLD ≥", "hold"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-28 font-mono2 text-[11px] text-muted-foreground">{label}</span>
                <input
                  type="range"
                  min={key === "strongBet" ? 85 : key === "bet" ? 75 : key === "watch" ? 65 : 40}
                  max={key === "strongBet" ? 99 : key === "bet" ? 94 : key === "watch" ? 84 : 74}
                  value={th[key]}
                  onChange={(e) => setTh({ ...th, [key]: Number(e.target.value) })}
                  className="flex-1 accent-[#22d3ee]"
                />
                <span className="w-8 text-right font-mono2 text-sm font-bold tabular-nums text-primary">{th[key]}</span>
              </div>
            ))}
            <button
              onClick={() => updateThresholds.mutate(th)}
              disabled={updateThresholds.isPending}
              className="mt-2 min-h-[44px] w-full rounded-sm bg-primary font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground disabled:opacity-40"
            >
              {updateThresholds.isPending
                ? "RE-EVALUATING ALL PICKS…"
                : updateThresholds.data
                  ? `APPLIED — ${updateThresholds.data.newVersions} NEW VERSIONS CREATED`
                  : "APPLY THRESHOLDS"}
            </button>
            {updateThresholds.error && (
              <p className="font-mono2 text-[10px] text-neg">{updateThresholds.error.message}</p>
            )}
          </div>
        </section>
      </div>

      {/* sportsbooks */}
      <section className="panel overflow-hidden rounded-sm">
        <p className="label-caps border-b border-border px-4 py-3">Sportsbook & affiliate management</p>
        <div className="divide-y divide-border">
          {data.books.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-28 font-mono2 text-xs font-bold">{b.name}</span>
              <span className="font-mono2 text-[10px] text-muted-foreground">PRIORITY {b.priority}</span>
              <input
                defaultValue={b.affiliateUrl ?? ""}
                placeholder="https://affiliate-url…"
                onBlur={(e) => {
                  if (e.target.value !== (b.affiliateUrl ?? "") && e.target.value.startsWith("http")) {
                    updateBook.mutate({ bookId: b.id, affiliateUrl: e.target.value });
                  }
                }}
                className="min-h-[36px] min-w-0 flex-1 rounded-sm border border-border bg-card px-2 font-mono2 text-[10px] text-muted-foreground outline-none focus:border-primary/50"
              />
              <button
                onClick={() => updateBook.mutate({ bookId: b.id, active: !b.active })}
                className={cn(
                  "min-h-[36px] rounded-sm border px-3 font-mono2 text-[10px] font-bold",
                  b.active ? "border-[#34d399]/40 text-pos" : "border-[#f87171]/40 text-neg",
                )}
              >
                {b.active ? "ACTIVE" : "INACTIVE"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* system logs */}
      <section className="panel overflow-hidden rounded-sm">
        <p className="label-caps border-b border-border px-4 py-3">System logs</p>
        <div className="max-h-64 overflow-y-auto">
          {data.logs.length === 0 && (
            <p className="px-4 py-6 text-center font-mono2 text-xs text-muted-foreground">No logged events yet.</p>
          )}
          {data.logs.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-2 font-mono2 text-[11px] last:border-0">
              <span
                className={cn(
                  "w-12 font-bold uppercase",
                  l.level === "error" ? "text-neg" : l.level === "warn" ? "text-warn" : "text-pos",
                )}
              >
                {l.level}
              </span>
              <span className="text-muted-foreground">{l.service}</span>
              <span className="min-w-0 flex-1 truncate">{l.message}</span>
              <span className="shrink-0 text-muted-foreground">{timeAgo(l.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
