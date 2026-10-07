import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useSportFilter } from "@/providers/sport-filter";
import { EdgeDial, SectionHead, Sparkline, StatusBadge } from "@/components/bits";
import { PickCard, selectionLabel } from "@/components/PickCard";
import { fmtLine, fmtOdds, num, pct, signedPct, timeAgo } from "@/lib/format";
import { ArrowRight, Brain, Database, Gauge, Radio, RefreshCw, Sigma } from "lucide-react";

function BestBetNow() {
  const { isVisible } = useSportFilter();
  const { data: list } = trpc.picks.list.useQuery(undefined, { refetchInterval: 15000 });
  const data =
    (list ?? [])
      .filter((r) => r.version && r.version.status !== "PASS" && isVisible(r.sportCode))
      .sort((a, b) => (b.version?.edgeScore ?? 0) - (a.version?.edgeScore ?? 0))[0] ?? null;
  if (!data?.version) {
    return (
      <div className="panel flex h-full min-h-[320px] items-center justify-center rounded-sm p-6">
        <p className="font-mono2 text-xs text-muted-foreground">NO ACTIVE EDGE — THE MODEL IS PATIENT</p>
      </div>
    );
  }
  const v = data.version;
  return (
    <div className="panel relative overflow-hidden rounded-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="label-caps flex items-center gap-2">
          <span className="led led-live" /> Best bet right now
        </span>
        <span className="font-mono2 text-[10px] text-muted-foreground">updated {timeAgo(v.createdAt)}</span>
      </div>
      <div className="flex items-center gap-5 p-5">
        <EdgeDial score={v.edgeScore} size={128} />
        <div className="min-w-0 flex-1">
          <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {data.away?.abbr} @ {data.home?.abbr} · {data.pick.market}
            {data.event?.status === "live" && (
              <span className="ml-2 text-live">LIVE {data.event.period} {data.event.clock}</span>
            )}
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight">
            {selectionLabel({ pick: data.pick, home: data.home!, away: data.away!, version: v } as never)}
          </p>
          <div className="mt-2">
            <StatusBadge status={v.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono2 text-[11px]">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">MODEL</dt><dd className="font-bold tabular-nums">{pct(v.modelProb)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">IMPLIED</dt><dd className="tabular-nums">{pct(v.impliedProb)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">EDGE</dt><dd className="text-pos tabular-nums">{signedPct(v.probEdge)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">EV</dt><dd className="text-pos tabular-nums">{signedPct(v.ev)}</dd></div>
            <div className="col-span-2 flex justify-between gap-2 border-t border-border pt-1.5">
              <dt className="text-muted-foreground">BEST PRICE</dt>
              <dd className="font-bold text-primary tabular-nums">{data.book?.name} {v.line !== null && data.pick.market !== "moneyline" ? `${fmtLine(v.line)} ` : ""}{fmtOdds(v.odds)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <Link
        to="/picks"
        className="flex items-center justify-center gap-2 border-t border-border bg-live-dim py-2.5 font-mono2 text-[10px] font-bold tracking-[0.18em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        FULL ANALYSIS <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

const PIPELINE = [
  { icon: Database, title: "Verified data", desc: "Sportsbook odds, injuries, weather and history flow into one normalized feed." },
  { icon: Sigma, title: "Quant models", desc: "Elo + regression + gradient boosting ensemble produces projections and probabilities." },
  { icon: Gauge, title: "Value engine", desc: "Model probability vs implied probability → edge, EV, AI Edge Score 0–100." },
  { icon: RefreshCw, title: "Dynamic picks", desc: "The pick is recalculated whenever the market moves. Every version is stored." },
  { icon: Brain, title: "AI layer", desc: "The AI explains the numbers — it never invents them." },
  { icon: Radio, title: "Live monitoring", desc: "Odds, lines and live games are watched continuously; changes trigger alerts." },
];

export default function Home() {
  const { isVisible } = useSportFilter();
  const { data: picks } = trpc.picks.list.useQuery(undefined, { refetchInterval: 20000 });
  const { data: perf } = trpc.performance.summary.useQuery();
  const top = (picks ?? [])
    .filter((p) => p.version && p.version.status !== "PASS" && isVisible(p.sportCode))
    .slice(0, 3);
  const curve = (perf?.curve ?? []).filter((_, i) => i % 2 === 0).map((c) => c.units);

  return (
    <div className="flex flex-col gap-14">
      {/* HERO */}
      <section className="grid items-center gap-8 pt-4 lg:grid-cols-[1.2fr_1fr] lg:pt-10">
        <div className="animate-fade-up">
          <p className="label-caps mb-4 flex items-center gap-2">
            <span className="led led-live" /> Real-time sports betting intelligence
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            THE PICK CHANGES
            <br />
            WHEN THE <span className="text-primary" style={{ textShadow: "0 0 24px rgba(34,211,238,0.4)" }}>MARKET</span> CHANGES.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Sportsbooks have spent decades pricing markets with sophisticated
            mathematics. <b className="text-foreground">We believe bettors should have access to
            powerful analytical tools too.</b> We measure the gap between{" "}
            <b className="text-foreground">model probability</b> and the{" "}
            <b className="text-foreground">sportsbook's price</b> — and tell you when the gap is worth betting.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/picks"
              className="rounded-sm bg-primary px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95"
            >
              VIEW TODAY'S PICKS
            </Link>
            <Link
              to="/premium"
              className="rounded-sm border border-primary/50 px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary transition-colors hover:bg-live-dim"
            >
              GO PRO
            </Link>
          </div>
          {perf && (
            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono2">
              {[
                ["WIN RATE", pct(perf.overall.winRate)],
                ["ROI", signedPct(perf.overall.roi)],
                ["UNITS", `${num(perf.overall.units) >= 0 ? "+" : ""}${num(perf.overall.units).toFixed(1)}u`],
                ["AVG CLV", `${num(perf.overall.avgClv) >= 0 ? "+" : ""}${num(perf.overall.avgClv).toFixed(2)}%`],
              ].map(([k, val]) => (
                <div key={k}>
                  <p className="label-caps" style={{ fontSize: 8 }}>{k}</p>
                  <p className="text-lg font-bold tabular-nums">{val}</p>
                </div>
              ))}
              {curve.length > 2 && <Sparkline points={curve} width={140} height={36} color="#34d399" baseline={0} />}
            </div>
          )}
        </div>
        <div className="animate-fade-up" style={{ animationDelay: "0.15s" }}>
          <BestBetNow />
        </div>
      </section>

      {/* TODAY'S BOARD */}
      <section>
        <SectionHead
          title="Today's board"
          sub="Ranked by AI Edge Score — recalculated every time the market moves."
          right={
            <Link to="/picks" className="font-mono2 text-[10px] tracking-[0.16em] text-primary hover:underline">
              ALL PICKS →
            </Link>
          }
        />
        <div className="flex flex-col gap-3">
          {top.length === 0 && (
            <div className="panel rounded-sm p-6 font-mono2 text-xs text-muted-foreground">
              NO ACTIVE POSITIONS ABOVE THRESHOLD — CHECK BACK AS THE MARKET MOVES.
            </div>
          )}
          {top.map((row) => (
            <PickCard key={row.pick.id} row={row} />
          ))}
        </div>
      </section>

      {/* LEVEL THE PLAYING FIELD */}
      <section className="panel relative overflow-hidden rounded-sm p-8 sm:p-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{ background: "radial-gradient(700px 240px at 20% 0%, rgba(34,211,238,0.22), transparent 70%)" }}
        />
        <p className="label-caps mb-3">Built to level the playing field</p>
        <h2 className="max-w-3xl text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
          SPORTSBOOK-LEVEL THINKING.
          <br />
          BUILT FOR <span className="text-primary">THE OTHER SIDE OF THE BET.</span>
        </h2>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Instead of asking "who do I think will win?", our models ask the
            question at the heart of quantitative sports betting:{" "}
            <b className="text-foreground">
              what is the probability of this outcome — and is the sportsbook
              offering a price that makes the risk worth taking?
            </b>
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Machine learning, Bayesian modeling, Elo ratings, Monte Carlo
            simulation, no-vig probabilities, line movement and closing-line
            value — one proprietary platform that evaluates every market from
            thousands of angles.{" "}
            <Link to="/about" className="font-mono2 text-[11px] text-primary hover:underline">
              HOW IT WORKS →
            </Link>
          </p>
        </div>
      </section>

      {/* PIPELINE */}
      <section>
        <SectionHead title="How the machine works" sub="A quantitative pipeline with an AI explanation layer — never the other way around." />
        <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((s, i) => (
            <div key={s.title} className="group bg-card p-5 transition-colors hover:bg-secondary">
              <div className="flex items-center justify-between">
                <s.icon className="h-5 w-5 text-primary" />
                <span className="font-mono2 text-[10px] text-muted-foreground">0{i + 1}</span>
              </div>
              <p className="mt-3 font-mono2 text-xs font-bold uppercase tracking-[0.14em]">{s.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SIMULATION BAND */}
      <section className="grid gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-[1fr_1.2fr]">
        <div className="bg-card p-6 sm:p-8">
          <p className="label-caps mb-2">Monte Carlo engine</p>
          <h3 className="text-2xl font-extrabold tracking-tight">10,000 SIMULATIONS. ONE DECISION.</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Instead of a single predicted score, our models simulate the event
            thousands of times and measure the full distribution of outcomes.
            Then we compare that probability against the price in the sportsbook
            market — that's where prediction becomes{" "}
            <b className="text-foreground">value analysis</b>.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 bg-secondary p-6 font-mono2 text-xs sm:p-8">
          <p className="label-caps mb-1">Example — 10,000 simulated games</p>
          {[
            ["TEAM A WINS", "6,180", "text-pos"],
            ["TEAM B WINS", "3,820", "text-muted-foreground"],
            ["ESTIMATED TEAM A WIN PROBABILITY", "61.8%", "text-foreground"],
          ].map(([k, val, cls]) => (
            <div key={k} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className={`font-bold tabular-nums ${cls}`}>{val}</span>
            </div>
          ))}
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-border">
            <div className="h-full w-[61.8%] bg-primary" style={{ boxShadow: "0 0 12px rgba(34,211,238,0.5)" }} />
          </div>
        </div>
      </section>

      {/* PREDICTION VS VALUE */}
      <section className="grid gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-2">
        <div className="bg-card p-6 sm:p-8">
          <p className="label-caps mb-2">The core idea</p>
          <h3 className="text-2xl font-extrabold tracking-tight">PREDICTION ≠ BETTING VALUE</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            A model might believe a team wins 62% of the time. That is a prediction.
            Whether it is a bet depends entirely on the price. At -105 the sportsbook
            implies 51.2% — an 10.8-point gap, and a +EV position. At -250 the same
            prediction is a bad bet. BetMetricAi prices that gap on every market,
            continuously.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 bg-secondary p-6 font-mono2 text-xs sm:p-8">
          {[
            ["MODEL PROBABILITY", "62.0%", "text-foreground"],
            ["IMPLIED @ -105", "51.2%", "text-muted-foreground"],
            ["PROBABILITY EDGE", "+10.8%", "text-pos"],
            ["EXPECTED VALUE / UNIT", "+7.1%", "text-pos"],
            ["AI EDGE SCORE", "92 / 100 — STRONG BET", "text-pos"],
          ].map(([k, val, cls]) => (
            <div key={k} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className={`font-bold tabular-nums ${cls}`}>{val}</span>
            </div>
          ))}
        </div>
      </section>

      {/* MARKET MOVES + TRANSPARENCY STRIP */}
      <section className="grid gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-3">
        {[
          {
            k: "The market moves. So do our models.",
            v: "A bet that was strong value at -105 may not be value at -140. Every pick is recalculated as odds, lines, injuries, lineups and weather change — and every version is stored.",
          },
          {
            k: "Every sport is different.",
            v: "One generic AI doesn't predict everything. Football, basketball, baseball, hockey, soccer, tennis, golf and combat sports each run on sport-specific mathematics.",
          },
          {
            k: "Transparency matters.",
            v: "No guaranteed winners. We track win rate, ROI, units, closing line value and calibration over time — because smart betting is better decisions, repeated.",
          },
        ].map((s) => (
          <div key={s.k} className="bg-card p-6">
            <p className="font-mono2 text-xs font-bold uppercase tracking-[0.12em] text-primary">{s.k}</p>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{s.v}</p>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="panel relative overflow-hidden rounded-sm p-8 text-center sm:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: "radial-gradient(600px 200px at 50% 0%, rgba(34,211,238,0.25), transparent 70%)" }}
        />
        <p className="label-caps mb-3">The house has data. Now you do too.</p>
        <h3 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          FULL AI EDGE · PLAYER PROPS · LIVE BETTING · AI ASSISTANT
        </h3>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
          Proprietary quantitative models. Real-time sportsbook markets. Advanced
          AI intelligence. $19.99/month or $199/year.
        </p>
        <Link
          to="/premium"
          className="mt-6 inline-block rounded-sm bg-primary px-8 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.03]"
        >
          GO PRO — $19.99/MO
        </Link>
      </section>
    </div>
  );
}
