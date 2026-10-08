import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState, SectionHead } from "@/components/bits";
import { fmtLine, fmtOdds, fmtTime, num, pct, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

function AddBetForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const add = trpc.tracker.add.useMutation({
    onSuccess: () => {
      utils.tracker.list.invalidate();
      utils.tracker.stats.invalidate();
      onDone();
    },
  });
  const [form, setForm] = useState({
    eventLabel: "",
    market: "spread",
    selection: "",
    line: "",
    odds: "-110",
    stake: "25",
  });

  return (
    <form
      className="panel grid gap-3 rounded-sm p-4 sm:grid-cols-2 lg:grid-cols-7"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({
          sport: "NFL",
          eventLabel: form.eventLabel,
          market: form.market,
          selection: form.selection,
          line: form.line === "" ? null : parseFloat(form.line),
          odds: parseInt(form.odds, 10),
          stake: parseFloat(form.stake),
        });
      }}
    >
      <input
        required
        placeholder="Event (e.g. BUF @ KC)"
        value={form.eventLabel}
        onChange={(e) => setForm({ ...form, eventLabel: e.target.value })}
        className="min-h-[44px] rounded-sm border border-border bg-card px-3 font-mono2 text-xs outline-none focus:border-primary/50 lg:col-span-2"
      />
      <select
        value={form.market}
        onChange={(e) => setForm({ ...form, market: e.target.value })}
        className="min-h-[44px] rounded-sm border border-border bg-card px-2 font-mono2 text-xs outline-none"
      >
        {["spread", "moneyline", "total", "prop", "parlay"].map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <input
        required
        placeholder="Selection (e.g. KC -3.5)"
        value={form.selection}
        onChange={(e) => setForm({ ...form, selection: e.target.value })}
        className="min-h-[44px] rounded-sm border border-border bg-card px-3 font-mono2 text-xs outline-none focus:border-primary/50"
      />
      <input
        placeholder="Odds (-110)"
        value={form.odds}
        onChange={(e) => setForm({ ...form, odds: e.target.value.replace(/[^0-9+-]/g, "") })}
        className="min-h-[44px] rounded-sm border border-border bg-card px-3 font-mono2 text-xs outline-none focus:border-primary/50"
      />
      <input
        placeholder="Stake ($)"
        value={form.stake}
        onChange={(e) => setForm({ ...form, stake: e.target.value.replace(/[^0-9.]/g, "") })}
        className="min-h-[44px] rounded-sm border border-border bg-card px-3 font-mono2 text-xs outline-none focus:border-primary/50"
      />
      <button
        type="submit"
        disabled={add.isPending}
        className="min-h-[44px] rounded-sm bg-primary font-mono2 text-[11px] font-bold tracking-[0.14em] text-primary-foreground disabled:opacity-40"
      >
        {add.isPending ? "LOGGING…" : "LOG BET"}
      </button>
    </form>
  );
}

export default function Tracker() {
  const { user, isLoading } = useAuth();
  const { isVisible } = useSportFilter();
  const { data: allBets } = trpc.tracker.list.useQuery(undefined, { enabled: !!user });
  const bets = (allBets ?? []).filter((b) => isVisible(b.sport));
  const { data: stats } = trpc.tracker.stats.useQuery(undefined, { enabled: !!user });
  const utils = trpc.useUtils();
  const settle = trpc.tracker.settle.useMutation({
    onSuccess: () => {
      utils.tracker.list.invalidate();
      utils.tracker.stats.invalidate();
    },
  });
  const remove = trpc.tracker.remove.useMutation({
    onSuccess: () => {
      utils.tracker.list.invalidate();
      utils.tracker.stats.invalidate();
    },
  });
  const [showForm, setShowForm] = useState(false);

  if (!isLoading && !user) {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <p className="label-caps mb-3">Bet tracker</p>
        <h2 className="text-2xl font-extrabold">SIGN IN TO TRACK YOUR BETS</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Your bankroll, results, ROI and CLV live in your account — synced across
          devices, never in your browser.
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

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Bet tracker"
        sub="Log every bet. Settle results. Watch ROI, units and closing line value accumulate."
        right={
          <button
            onClick={() => setShowForm(!showForm)}
            className="min-h-[44px] rounded-sm bg-primary px-4 font-mono2 text-[10px] font-bold tracking-[0.14em] text-primary-foreground"
          >
            {showForm ? "CLOSE" : "+ LOG BET"}
          </button>
        }
      />

      {stats && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["BETS", `${stats.totalBets}`],
            ["RECORD", `${stats.wins}-${stats.losses}-${stats.pushes}`],
            ["WIN RATE", pct(stats.winRate)],
            ["PROFIT", `${stats.profit >= 0 ? "+" : ""}$${stats.profit.toFixed(2)}`],
            ["ROI", signedPct(stats.roi)],
            ["EXPOSURE", `$${stats.exposure.toFixed(2)}`],
          ].map(([k, val], i) => (
            <div key={k} className="bg-card px-4 py-3">
              <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
              <p className={cn("mt-1 text-lg font-bold tabular-nums", i === 3 && (stats.profit >= 0 ? "text-pos" : "text-neg"), i === 4 && (stats.roi >= 0 ? "text-pos" : "text-neg"))}>{val}</p>
            </div>
          ))}
        </div>
      )}

      {showForm && <AddBetForm onDone={() => setShowForm(false)} />}

      <div className="panel overflow-x-auto rounded-sm">
        <table className="w-full min-w-[820px] border-collapse font-mono2 text-xs">
          <thead>
            <tr className="border-b border-border text-left">
              {["PLACED", "EVENT", "SELECTION", "ODDS", "STAKE", "STATUS", "PROFIT", ""].map((h) => (
                <th key={h} className="label-caps px-3 py-2.5 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(bets ?? []).map((b) => (
              <tr key={b.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/50">
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{fmtTime(b.placedAt)}</td>
                <td className="px-3 py-2.5">{b.eventLabel}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-bold">
                  {b.selection} {b.line !== null && <span className="text-muted-foreground">{fmtLine(b.line)}</span>}
                </td>
                <td className="px-3 py-2.5 tabular-nums">{fmtOdds(b.odds)}</td>
                <td className="px-3 py-2.5 tabular-nums">${num(b.stake).toFixed(2)}</td>
                <td className="px-3 py-2.5">
                  {b.result === "pending" ? (
                    <span className="flex gap-1">
                      {(["won", "lost", "push"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => settle.mutate({ betId: b.id, result: r })}
                          className={cn(
                            "min-h-[32px] rounded-sm border px-2 text-[10px] font-bold uppercase",
                            r === "won" && "border-[#34d399]/40 text-pos hover:bg-pos-dim",
                            r === "lost" && "border-[#f87171]/40 text-neg hover:bg-neg-dim",
                            r === "push" && "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {r}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className={cn("font-bold uppercase", b.result === "won" ? "text-pos" : b.result === "lost" ? "text-neg" : "text-muted-foreground")}>
                      {b.result}
                    </span>
                  )}
                </td>
                <td className={cn("px-3 py-2.5 tabular-nums font-bold", num(b.profit) > 0 ? "text-pos" : num(b.profit) < 0 ? "text-neg" : "")}>
                  {b.result === "pending" ? "—" : `${num(b.profit) >= 0 ? "+" : ""}$${num(b.profit).toFixed(2)}`}
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => remove.mutate({ betId: b.id })} className="min-h-[32px] min-w-[32px] text-muted-foreground hover:text-neg">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(bets ?? []).length === 0 && (
          <div className="p-6">
            <EmptyState title="No bets logged yet" hint="Log your first bet above — settled bets build your bankroll analytics automatically." />
          </div>
        )}
      </div>
    </div>
  );
}
