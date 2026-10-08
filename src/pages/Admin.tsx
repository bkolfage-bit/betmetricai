import { useEffect, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { SectionHead } from "@/components/bits";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";
import { UpgradeReport } from "@/pages/Sports";

type EdgeWeightDraft = {
  probEdge: number;
  ev: number;
  confidence: number;
  agreement: number;
  lineStability: number;
};

function ModelRegistry() {
  const utils = trpc.useUtils();
  const { data: modelRows, refetch } = trpc.models.list.useQuery();
  const { data: queue, refetch: refetchQueue } = trpc.models.retrainQueue.useQuery();
  const updateStatus = trpc.models.updateStatus.useMutation({
    onSuccess: () => {
      refetch();
      utils.models.list.invalidate();
    },
  });
  const retrain = trpc.models.requestRetrain.useMutation({
    onSuccess: () => refetchQueue(),
  });
  const updateWeights = trpc.models.updateEdgeWeights.useMutation();
  const [weightSport, setWeightSport] = useState<string>("NFL");
  const { data: weightData } = trpc.models.edgeWeights.useQuery({ sportCode: weightSport });
  const [draft, setDraft] = useState<EdgeWeightDraft | null>(null);

  useEffect(() => {
    const w = weightData?.[weightSport];
    if (w) setDraft({ ...w });
  }, [weightData, weightSport]);

  return (
    <>
      {/* model registry */}
      <section className="panel overflow-hidden rounded-sm">
        <p className="label-caps border-b border-border px-4 py-3">
          Model registry — lifecycle, health and retraining controls
        </p>
        <div className="divide-y divide-border">
          {(modelRows ?? []).map((m) => (
            <div key={m.modelId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-24 font-mono2 text-xs font-bold">{m.sportCode}</span>
              <span className="font-mono2 text-[10px] text-muted-foreground">
                {m.modelId} · v{m.modelVersion}
              </span>
              <span
                className={cn(
                  "rounded-sm border px-2 py-0.5 font-mono2 text-[9px] font-bold",
                  m.healthStatus === "HEALTHY" && "border-[#34d399]/40 text-pos",
                  m.healthStatus === "WARNING" && "border-[#fbbf24]/40 text-warn",
                  (m.healthStatus === "DEGRADED" || m.healthStatus === "DISABLED") &&
                    "border-[#f87171]/40 text-neg",
                )}
              >
                {m.healthStatus}
              </span>
              <span className="min-w-0 flex-1" />
              <button
                onClick={() =>
                  updateStatus.mutate({
                    modelId: m.modelId,
                    status: m.status === "disabled" ? "production" : "disabled",
                  })
                }
                disabled={updateStatus.isPending}
                className={cn(
                  "min-h-[36px] rounded-sm border px-3 font-mono2 text-[10px] font-bold",
                  m.status === "disabled"
                    ? "border-[#f87171]/40 text-neg"
                    : "border-[#34d399]/40 text-pos",
                )}
              >
                {m.status.toUpperCase()}
              </button>
              <button
                onClick={() => retrain.mutate({ modelId: m.modelId })}
                disabled={retrain.isPending}
                className="min-h-[36px] rounded-sm border border-primary/40 px-3 font-mono2 text-[10px] font-bold text-primary disabled:opacity-40"
              >
                {retrain.isPending ? "VALIDATING…" : "RETRAIN"}
              </button>
            </div>
          ))}
        </div>
        {retrain.data && (
          <div className="border-t border-border px-4 py-3">
            <p className="label-caps mb-2" style={{ fontSize: 8 }}>
              Validation gates — {retrain.data.passed ? "PASSED, queued for admin review" : "FAILED"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {retrain.data.gates.map((g) => (
                <span
                  key={g.name}
                  title={g.detail}
                  className={cn(
                    "rounded-sm border px-2 py-1 font-mono2 text-[9px] font-bold",
                    g.ok ? "border-[#34d399]/40 text-pos" : "border-[#f87171]/40 text-neg",
                  )}
                >
                  {g.ok ? "✓" : "✗"} {g.name}
                </span>
              ))}
            </div>
            <p className="mt-2 font-mono2 text-[10px] text-muted-foreground">
              Candidate models are never auto-deployed — production promotion requires admin review.
            </p>
          </div>
        )}
        {(queue ?? []).length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <p className="label-caps mb-2" style={{ fontSize: 8 }}>Retrain review queue</p>
            {(queue ?? []).map((q, i) => (
              <p key={i} className="font-mono2 text-[10px] text-muted-foreground">
                {q.modelId} — requested {timeAgo(q.requestedAt)} · review:{" "}
                <b className="text-warn">{q.review.toUpperCase()}</b>
              </p>
            ))}
          </div>
        )}
      </section>

      {/* edge weight editor */}
      <section className="panel rounded-sm p-5">
        <p className="label-caps mb-1">AI Edge Score weights — per sport</p>
        <p className="mb-4 text-[11px] text-muted-foreground">
          Controls how probability edge, EV, confidence, model agreement and line stability blend
          into the 0–100 AI Edge Score. Applies to new pick versions immediately.
        </p>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(modelRows ?? []).map((m) => (
            <button
              key={m.sportCode}
              onClick={() => setWeightSport(m.sportCode)}
              className={cn(
                "min-h-[36px] rounded-sm border px-2.5 font-mono2 text-[10px] font-bold tracking-[0.1em]",
                weightSport === m.sportCode
                  ? "border-primary bg-live-dim text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {m.sportCode}
            </button>
          ))}
        </div>
        {draft && (
          <div className="space-y-3">
            {(
              [
                ["PROB EDGE", "probEdge", 0, 1],
                ["EV", "ev", 0, 1],
                ["CONFIDENCE", "confidence", 0, 0.5],
                ["AGREEMENT", "agreement", 0, 0.5],
                ["LINE STABILITY", "lineStability", 0, 0.5],
              ] as const
            ).map(([label, key, lo, hi]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-28 font-mono2 text-[11px] text-muted-foreground">{label}</span>
                <input
                  type="range"
                  min={lo}
                  max={hi}
                  step={0.01}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                  className="flex-1 accent-[#22d3ee]"
                />
                <span className="w-12 text-right font-mono2 text-sm font-bold tabular-nums text-primary">
                  {draft[key].toFixed(2)}
                </span>
              </div>
            ))}
            <button
              onClick={() =>
                updateWeights.mutate({ sportCode: weightSport, weights: draft })
              }
              disabled={updateWeights.isPending}
              className="mt-2 min-h-[44px] w-full rounded-sm bg-primary font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground disabled:opacity-40"
            >
              {updateWeights.isPending
                ? "APPLYING…"
                : updateWeights.data
                  ? `APPLIED TO ${weightSport}`
                  : `APPLY ${weightSport} WEIGHTS`}
            </button>
            {updateWeights.error && (
              <p className="font-mono2 text-[10px] text-neg">{updateWeights.error.message}</p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/* ----------------------- production odds feed panel ---------------------- */

const HEALTH_STYLE: Record<string, string> = {
  healthy: "border-[#34d399]/40 text-pos",
  warning: "border-[#fbbf24]/40 text-warn",
  degraded: "border-[#f87171]/40 text-neg",
  offline: "border-[#f87171]/40 text-neg",
  unavailable: "border-border text-muted-foreground",
};

function FeedDashboard() {
  const utils = trpc.useUtils();
  const { data, refetch } = trpc.feed.dashboard.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const discover = trpc.feed.discover.useMutation({ onSuccess: () => refetch() });
  const syncSport = trpc.feed.syncSport.useMutation({
    onSuccess: () => {
      refetch();
      utils.invalidate();
    },
  });
  const setMode = trpc.feed.setMode.useMutation({ onSuccess: () => refetch() });
  if (!data) return null;

  const q = data.quota;
  const activeSports = [...new Set(
    data.sportMap.filter((m) => m.status === "active").map((m) => m.sportCode),
  )];

  return (
    <section className="panel overflow-hidden rounded-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="label-caps">Production odds feed — The Odds API v4</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => discover.mutate()}
            disabled={discover.isPending}
            className="rounded-sm border border-border px-2.5 py-1 font-mono2 text-[9px] font-bold tracking-[0.12em] text-foreground hover:border-primary/50 disabled:opacity-40"
          >
            {discover.isPending ? "DISCOVERING…" : "RUN DISCOVERY (FREE)"}
          </button>
          <button
            onClick={() => setMode.mutate({ mode: data.mode === "live" ? "demo" : "live" })}
            disabled={setMode.isPending || !data.providerConfigured}
            className={cn(
              "rounded-sm border px-2.5 py-1 font-mono2 text-[9px] font-bold tracking-[0.12em] disabled:opacity-40",
              data.mode === "live"
                ? "border-[#34d399]/50 bg-pos-dim text-pos"
                : "border-[#fbbf24]/50 bg-warn-dim text-warn",
            )}
          >
            MODE: {data.mode === "live" ? "LIVE FEED" : "PAUSED"} — SWITCH
          </button>
        </div>
      </div>

      {/* quota cards */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border font-mono2 sm:grid-cols-5">
        {[
          ["CREDITS USED", q.used != null ? `${q.used}` : "—"],
          ["CREDITS REMAINING", q.remaining != null ? `${q.remaining}` : "—"],
          ["MONTHLY BASELINE", q.baseline != null ? `${q.baseline}` : "—"],
          ["QUOTA TIER", q.tier.toUpperCase()],
          ["PROVIDER KEY", data.providerConfigured ? "CONFIGURED · SERVER-ONLY" : "MISSING"],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
            <p className="mt-1 text-sm font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {/* per-sport health + manual sync */}
      <div className="divide-y divide-border">
        {data.health.length === 0 && (
          <p className="px-4 py-4 font-mono2 text-[10px] text-muted-foreground">
            No feed state yet — run discovery, then sync a sport.
          </p>
        )}
        {data.health.map((h) => (
          <div key={h.sportCode} className="flex flex-wrap items-center gap-3 px-4 py-2.5 font-mono2 text-[10px]">
            <span className="w-24 font-bold">{h.sportCode}</span>
            <span className={cn("rounded-sm border px-2 py-0.5 text-[9px] font-bold uppercase", HEALTH_STYLE[h.status])}>
              {h.status}
            </span>
            <span className="text-muted-foreground">
              {h.lastSuccessAt ? `last ok ${timeAgo(h.lastSuccessAt)}` : "never synced"}
              {h.consecutiveFailures > 0 ? ` · ${h.consecutiveFailures} failures` : ""}
            </span>
            <span className="flex-1 truncate text-muted-foreground/70">{h.message}</span>
            {activeSports.includes(h.sportCode) && (
              <button
                onClick={() => syncSport.mutate({ sportCode: h.sportCode })}
                disabled={syncSport.isPending}
                className="rounded-sm border border-border px-2 py-0.5 text-[9px] font-bold hover:border-primary/50 disabled:opacity-40"
              >
                SYNC NOW
              </button>
            )}
          </div>
        ))}
      </div>

      {/* discovered provider keys */}
      <div className="border-t border-border px-4 py-3">
        <p className="label-caps mb-2" style={{ fontSize: 8 }}>Discovered provider sport keys</p>
        <div className="flex flex-wrap gap-1.5">
          {data.sportMap.map((m) => (
            <span
              key={`${m.sportCode}:${m.providerSportKey}`}
              className="rounded-sm border border-border px-1.5 py-0.5 font-mono2 text-[9px] text-muted-foreground"
            >
              {m.sportCode} → {m.providerSportKey}
            </span>
          ))}
        </div>
      </div>

      {/* recent provider calls */}
      <div className="border-t border-border px-4 py-3">
        <p className="label-caps mb-2" style={{ fontSize: 8 }}>Recent provider calls (cost in credits)</p>
        <div className="space-y-1 font-mono2 text-[10px]">
          {data.lastCalls.slice(0, 8).map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <span className={cn("w-10 font-bold", c.status === "ok" ? "text-pos" : "text-neg")}>
                {c.status.toUpperCase()}
              </span>
              <span className="flex-1 truncate text-muted-foreground">{c.endpoint}</span>
              <span className="tabular-nums">cost {c.cost}</span>
              <span className="tabular-nums text-muted-foreground">left {c.requestsRemaining ?? "—"}</span>
              <span className="text-muted-foreground">{timeAgo(c.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


/** Grant / revoke PRO access for any account (testers, beta users). */
function UserManagement({ currentUserId }: { currentUserId: number }) {
  const { data: users, refetch } = trpc.admin.listUsers.useQuery();
  const setPlan = trpc.admin.setPlan.useMutation({
    onSuccess: () => refetch(),
  });
  if (!users) return null;
  return (
    <section className="panel overflow-x-auto rounded-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
        <div>
          <p className="label-caps">User access management</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Grant PRO to testers instantly — revoke just as fast. Changes apply on the user's next request.
          </p>
        </div>
        <span className="font-mono2 text-[10px] text-muted-foreground">
          {users.filter((u) => u.plan === "pro").length} PRO / {users.length} TOTAL
        </span>
      </div>
      <table className="mt-4 w-full min-w-[680px] border-collapse font-mono2 text-xs">
        <thead>
          <tr className="border-y border-border text-left">
            {["USER", "EMAIL", "AUTH", "ROLE", "PLAN", "LAST SIGN-IN", "ACCESS"].map((h) => (
              <th key={h} className="label-caps px-5 py-2.5 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="border-b border-border/60 last:border-0">
                <td className="px-5 py-2.5 font-bold">
                  {u.name ?? "—"}
                  {isSelf && <span className="ml-2 text-[9px] text-primary">YOU</span>}
                </td>
                <td className="px-5 py-2.5 text-muted-foreground">{u.email ?? "—"}</td>
                <td className="px-5 py-2.5 uppercase text-muted-foreground">{u.authType}</td>
                <td className="px-5 py-2.5">
                  <span className={u.role === "admin" ? "font-bold text-warn" : "text-muted-foreground"}>
                    {u.role.toUpperCase()}
                  </span>
                </td>
                <td className="px-5 py-2.5">
                  <span className={u.plan === "pro" ? "font-bold text-pos" : "text-muted-foreground"}>
                    {u.plan.toUpperCase()}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-muted-foreground">{timeAgo(u.lastSignInAt)}</td>
                <td className="px-5 py-2.5">
                  <button
                    disabled={setPlan.isPending || (isSelf && u.plan === "pro")}
                    onClick={() =>
                      setPlan.mutate({
                        userId: u.id,
                        plan: u.plan === "pro" ? "free" : "pro",
                      })
                    }
                    className={cn(
                      "min-h-[36px] rounded-sm border px-3 font-mono2 text-[10px] font-bold tracking-[0.12em] disabled:opacity-40",
                      u.plan === "pro"
                        ? "border-[#f87171]/40 text-neg hover:bg-neg/10"
                        : "border-[#34d399]/40 text-pos hover:bg-pos/10",
                    )}
                  >
                    {u.plan === "pro" ? "REVOKE PRO" : "GRANT PRO"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Testimonial moderation queue — approve/reject/feature/verify submitted
 * reviews. Review text and star ratings are displayed exactly as submitted
 * and are never editable here; moderation only controls publication state.
 */
function TestimonialModeration() {
  const utils = trpc.useUtils();
  const { data } = trpc.testimonials.adminList.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const moderate = trpc.testimonials.moderate.useMutation({
    onSuccess: () => utils.testimonials.adminList.invalidate(),
  });
  const reviews = data?.reviews ?? [];
  const pendingCount = reviews.filter((r) => r.status === "pending").length;

  const btn = (label: string, onClick: () => void, cls: string) => (
    <button
      key={label}
      onClick={onClick}
      className={cn("min-h-[32px] rounded-sm border px-2.5 font-mono2 text-[9px] font-bold tracking-[0.1em]", cls)}
    >
      {label}
    </button>
  );

  return (
    <section className="panel overflow-hidden rounded-sm">
      <p className="label-caps border-b border-border px-4 py-3">
        Customer reviews — moderation queue
        {pendingCount > 0 && <span className="ml-2 text-warn">{pendingCount} pending</span>}
      </p>
      {reviews.length === 0 && (
        <p className="px-4 py-6 text-center font-mono2 text-xs text-muted-foreground">
          No submitted reviews in the queue yet. Approved reviews appear on
          the homepage automatically.
        </p>
      )}
      <div className="divide-y divide-border">
        {reviews.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono2 text-[10px]">
              <span className="font-bold text-foreground">{r.displayName}</span>
              <span className="text-[#fbbf24]">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 font-bold uppercase tracking-[0.1em]",
                  r.status === "approved"
                    ? "border-[#34d399]/40 text-pos"
                    : r.status === "rejected"
                      ? "border-[#f87171]/40 text-neg"
                      : "border-warn/40 text-warn",
                )}
              >
                {r.status}
              </span>
              {r.verified === 1 && <span className="text-pos">VERIFIED</span>}
              {r.featured === 1 && <span className="text-primary">FEATURED</span>}
              <span className="text-muted-foreground">{r.email}</span>
              <span className="text-muted-foreground">{timeAgo(r.createdAt)}</span>
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">"{r.text}"</p>
            <div className="flex flex-wrap gap-1.5">
              {r.status !== "approved" &&
                btn("APPROVE", () => moderate.mutate({ id: r.id, action: "approve" }), "border-[#34d399]/40 text-pos")}
              {r.status !== "rejected" &&
                btn("REJECT", () => moderate.mutate({ id: r.id, action: "reject" }), "border-[#f87171]/40 text-neg")}
              {r.status === "approved" &&
                (r.featured === 1
                  ? btn("UNFEATURE", () => moderate.mutate({ id: r.id, action: "unfeature" }), "border-border text-muted-foreground")
                  : btn("FEATURE", () => moderate.mutate({ id: r.id, action: "feature" }), "border-primary/40 text-primary"))}
              {r.verified === 1
                ? btn("UNVERIFY", () => moderate.mutate({ id: r.id, action: "unverify" }), "border-border text-muted-foreground")
                : btn("VERIFY", () => moderate.mutate({ id: r.id, action: "verify" }), "border-[#34d399]/40 text-pos")}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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

      <FeedDashboard />

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

      <UserManagement currentUserId={user!.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* feed status */}
        <section className="panel rounded-sm p-5">
          <p className="label-caps mb-4">Feed & model status</p>
          <div className="space-y-3 font-mono2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ODDS FEED</span>
              <span className={cn("flex items-center gap-2 font-bold", feedOk ? "text-pos" : "text-neg")}>
                <span className={cn("led", feedOk ? "led-pos" : "led-neg")} />
                {feedOk ? `HEALTHY · ticked ${timeAgo(data.lastTick)}` : "STALLED"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">DATA MODE</span>
              <span className="font-bold text-pos">LIVE — PRODUCTION FEED</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">MODELS</span>
              <span>11 sport ensembles — registry below</span>
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

      <UpgradeReport />

      <ModelRegistry />

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

      {/* testimonial moderation */}
      <TestimonialModeration />

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
