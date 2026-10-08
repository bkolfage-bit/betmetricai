import { Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { SectionHead } from "@/components/bits";
import {
  ArrowRight,
  Brain,
  CircleDot,
  Dices,
  Gauge,
  LineChart,
  Scale,
  Shield,
  Sigma,
  Swords,
  Trophy,
} from "lucide-react";

const AI_EDGE_SIGNALS = [
  "MODEL PROBABILITY",
  "SPORTSBOOK IMPLIED PROBABILITY",
  "NO-VIG MARKET PROBABILITY",
  "EXPECTED VALUE",
  "MODEL AGREEMENT",
  "PRICE QUALITY",
  "LINE MOVEMENT",
  "INJURY & LINEUP CERTAINTY",
  "DATA FRESHNESS",
  "MODEL CALIBRATION",
  "MARKET VOLATILITY",
];

const MARKET_TRIGGERS = [
  "sportsbook odds move",
  "spreads or totals change",
  "a better price becomes available",
  "an injury is announced",
  "a starting lineup changes",
  "a starting pitcher changes",
  "a goalie is confirmed",
  "weather conditions change",
  "new player information becomes available",
  "live game conditions change",
];

const SPORT_MODELS = [
  { icon: Trophy, name: "Football", desc: "Efficiency, EPA, quarterback performance, game script and weather." },
  { icon: CircleDot, name: "Basketball", desc: "Pace, efficiency, player usage, rotations and lineup changes." },
  { icon: CircleDot, name: "Baseball", desc: "Starting pitchers, bullpens, batter matchups, park factors and pitch characteristics." },
  { icon: CircleDot, name: "Hockey", desc: "Expected goals, shot quality, special teams and goaltending." },
  { icon: CircleDot, name: "Soccer", desc: "Expected goals, attack and defensive strength, lineups and draw probability." },
  { icon: CircleDot, name: "Tennis", desc: "Surface-specific performance, serve/return efficiency and point-by-point match probabilities." },
  { icon: CircleDot, name: "Golf", desc: "Full tournament-field simulation using player performance, course fit and conditions." },
  { icon: Swords, name: "Combat sports", desc: "Striking, grappling, finishing ability, opponent quality and fight-specific matchups." },
];

const TRACKED_METRICS = [
  "Win/loss/push record",
  "Return on investment",
  "Units won or lost",
  "Closing line value",
  "Calibration",
  "Performance by sport",
  "Performance by market",
  "Performance by AI Edge range",
];

export default function About() {
  const { user } = useAuth();
  const isPro = user?.plan === "pro" || user?.role === "admin";
  return (
    <div className="flex flex-col gap-14">
      {/* HERO — level the playing field */}
      <section className="max-w-3xl pt-4">
        <p className="label-caps mb-4 flex items-center gap-2">
          <Scale className="h-3.5 w-3.5 text-primary" /> Built to level the playing field
        </p>
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          ADVANCED QUANTITATIVE INTELLIGENCE.
          <br />
          <span className="text-primary" style={{ textShadow: "0 0 24px rgba(34,211,238,0.4)" }}>
            BUILT FOR BETTORS.
          </span>
        </h1>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Sportsbooks have spent decades using sophisticated mathematics, massive
          datasets, statistical modeling, and real-time market information to
          understand risk and price betting markets.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-foreground sm:text-base">
          We believe bettors should have access to powerful analytical tools too.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Our proprietary AI modeling platform combines advanced statistical
          analysis, machine learning, simulation, real-time sportsbook pricing,
          historical performance data, player and team analytics, injuries,
          lineups, weather, market movement, and other relevant variables to
          evaluate betting markets from thousands of angles.
        </p>
        <p className="mt-6 border-l-2 border-primary pl-4 text-base font-bold leading-relaxed sm:text-lg">
          The objective is simple: bring institutional-grade sports analytics to
          everyday bettors and help level the analytical playing field.
        </p>
      </section>

      {/* MORE THAN AN AI PICK GENERATOR */}
      <section>
        <SectionHead
          title="More than an AI pick generator"
          sub="Our system doesn't simply ask an AI which team will win. Behind every recommendation is a quantitative modeling infrastructure designed specifically for sports and betting markets."
        />
        <div className="panel rounded-sm p-6 sm:p-8">
          <p className="label-caps mb-4">Depending on the sport and market, the framework can incorporate</p>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Machine-learning models",
              "Statistical regression models",
              "Bayesian modeling",
              "Elo and dynamic team/player ratings",
              "Monte Carlo simulation",
              "Sport-specific probability models",
              "Player-level projections",
              "Team efficiency models",
              "Injury and lineup adjustments",
              "Weather and venue effects",
              "Real-time sportsbook odds",
              "Market-implied probabilities",
              "No-vig market probabilities",
              "Line movement",
              "Expected-value calculations",
              "Probability calibration",
              "Model agreement",
              "Historical backtesting",
              "Closing-line-value analysis",
            ].map((x) => (
              <p key={x} className="flex items-center gap-2 font-mono2 text-[11px] text-muted-foreground">
                <span className="text-primary">+</span> {x}
              </p>
            ))}
          </div>
          <p className="mt-6 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            The result isn't simply a prediction. It's a continuously updated
            estimate of{" "}
            <b className="text-foreground">probability, price and value</b>.
          </p>
        </div>
      </section>

      {/* SPORTSBOOK-LEVEL THINKING */}
      <section className="grid gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-2">
        <div className="bg-card p-6 sm:p-8">
          <p className="label-caps mb-2">Sportsbook-level thinking</p>
          <h3 className="text-2xl font-extrabold tracking-tight">
            BUILT FOR THE OTHER SIDE OF THE BET.
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Professional sportsbooks and sophisticated quantitative betting
            operations rely on data, probability, statistical modeling and
            market intelligence when evaluating betting markets. Our technology
            brings many of those same classes of analytical techniques together
            into one proprietary platform designed for bettors.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-5 bg-secondary p-6 sm:p-8">
          <div>
            <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Instead of asking
            </p>
            <p className="mt-1 text-lg font-bold text-muted-foreground line-through decoration-neg/60">
              "Who do I think will win?"
            </p>
          </div>
          <div>
            <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-primary">
              Our models are designed to ask
            </p>
            <p className="mt-1 text-lg font-extrabold leading-snug">
              "What is the probability of this outcome — and is the sportsbook
              offering a price that makes the risk worth taking?"
            </p>
          </div>
          <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            That distinction is at the heart of quantitative sports betting.
          </p>
        </div>
      </section>

      {/* AI EDGE */}
      <section>
        <SectionHead
          title="Our proprietary AI Edge"
          sub="Every opportunity is evaluated through the AI Edge system — multiple signals converted into one easy-to-understand score that shows which opportunities deserve further attention."
        />
        <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {AI_EDGE_SIGNALS.map((s, i) => (
            <div key={s} className="flex items-center gap-3 bg-card px-4 py-3.5">
              <span className="font-mono2 text-[10px] text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono2 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/90">
                {s}
              </span>
              {i < AI_EDGE_SIGNALS.length - 1 && (
                <span className="ml-auto font-mono2 text-[10px] text-muted-foreground/40">+</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* THE MARKET MOVES */}
      <section className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionHead
            title="The market moves. So do our models."
            sub="A prediction shouldn't remain frozen while the market changes. The platform continuously evaluates new information."
          />
          <div className="panel rounded-sm p-5">
            <p className="font-mono2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              A recommendation may change when
            </p>
            <ul className="mt-3 space-y-1.5">
              {MARKET_TRIGGERS.map((t) => (
                <li key={t} className="flex items-center gap-2 font-mono2 text-[11px] text-muted-foreground">
                  <span className="h-1 w-1 rounded-full bg-primary" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-4 rounded-sm border border-border bg-card p-6 sm:p-8">
          <p className="text-xl font-extrabold leading-snug tracking-tight sm:text-2xl">
            A bet that represented strong value at{" "}
            <span className="text-pos">-105</span> may no longer represent value
            at <span className="text-neg">-140</span>.
          </p>
          <p className="font-mono2 text-xs uppercase tracking-[0.16em] text-primary">
            Our system is designed to recognize the difference.
          </p>
          <div className="mt-2 flex items-center gap-3 font-mono2 text-[10px] text-muted-foreground">
            <LineChart className="h-4 w-4 text-primary" />
            Every pick version is stored — the full timeline stays visible.
          </div>
        </div>
      </section>

      {/* EVERY SPORT IS DIFFERENT */}
      <section>
        <SectionHead
          title="Every sport is different"
          sub="We don't believe one generic AI model should predict every sport. Different sports require different mathematics — our platform is built accordingly."
        />
        <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {SPORT_MODELS.map((s) => (
            <div key={s.name} className="bg-card p-5 transition-colors hover:bg-secondary">
              <s.icon className="h-4 w-4 text-primary" />
              <p className="mt-2.5 font-mono2 text-xs font-bold uppercase tracking-[0.14em]">{s.name}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 10,000 SIMULATIONS */}
      <section className="grid gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-2">
        <div className="bg-card p-6 sm:p-8">
          <p className="label-caps mb-2 flex items-center gap-2">
            <Dices className="h-3.5 w-3.5 text-primary" /> Monte Carlo engine
          </p>
          <h3 className="text-2xl font-extrabold tracking-tight">10,000 SIMULATIONS. ONE DECISION.</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Where appropriate, our models run thousands of simulations of an
            event to estimate the distribution of possible outcomes rather than
            relying on a single predicted score. We then compare that
            probability against the price available in the sportsbook market.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            That's where prediction becomes{" "}
            <b className="text-foreground">value analysis</b>.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 bg-secondary p-6 font-mono2 text-xs sm:p-8">
          <p className="label-caps mb-1">Example — 10,000 Monte Carlo simulations</p>
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

      {/* AI DOESN'T REPLACE THE MATH */}
      <section>
        <SectionHead
          title="AI doesn't replace the math"
          sub="Artificial intelligence is an important part of our technology, but it does not invent our probabilities. The quantitative models generate the numbers — the AI intelligence layer helps interpret them."
        />
        <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {[
            { icon: Sigma, k: "QUANTITATIVE MODELS", v: "PROBABILITY" },
            { icon: Gauge, k: "SPORTSBOOK MARKET", v: "PRICE" },
            { icon: Scale, k: "VALUE ENGINE", v: "EXPECTED VALUE" },
            { icon: Trophy, k: "AI EDGE", v: "OPPORTUNITY RANKING" },
            { icon: Brain, k: "AI INTELLIGENCE", v: "EXPLANATION" },
          ].map((s) => (
            <div key={s.k} className="bg-card p-5 text-center">
              <s.icon className="mx-auto h-4 w-4 text-primary" />
              <p className="mt-2.5 font-mono2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{s.k}</p>
              <p className="mt-1 font-mono2 text-[11px] font-bold uppercase tracking-[0.1em] text-foreground">→ {s.v}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          This separation keeps our analysis grounded in data — never AI-generated guesses.
        </p>
      </section>

      {/* TRANSPARENCY */}
      <section className="grid gap-px overflow-hidden rounded-sm border border-border bg-border lg:grid-cols-2">
        <div className="bg-card p-6 sm:p-8">
          <p className="label-caps mb-2 flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary" /> Transparency matters
          </p>
          <h3 className="text-2xl font-extrabold tracking-tight">NO GUARANTEED WINNERS. EVER.</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            No model can predict sports with certainty. We don't promise
            guaranteed winners, and we don't claim every high-confidence
            prediction will win. Instead, our objective is to identify
            situations where our models estimate that the probability of an
            outcome is meaningfully different from the probability implied by
            the sportsbook's price.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Sophisticated betting analysis isn't about being right every time.
            It's about making{" "}
            <b className="text-foreground">better-informed decisions repeatedly over time</b>.
          </p>
        </div>
        <div className="bg-secondary p-6 sm:p-8">
          <p className="label-caps mb-3">Our performance system tracks, over time</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRACKED_METRICS.map((m) => (
              <p key={m} className="flex items-center gap-2 font-mono2 text-[11px] text-muted-foreground">
                <span className="text-primary">▪</span> {m}
              </p>
            ))}
          </div>
          <Link
            to="/performance"
            className="mt-5 inline-flex items-center gap-2 font-mono2 text-[10px] tracking-[0.16em] text-primary hover:underline"
          >
            SEE THE FULL TRACK RECORD <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      {/* CLOSER */}
      <section className="panel relative overflow-hidden rounded-sm p-8 text-center sm:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: "radial-gradient(600px 220px at 50% 0%, rgba(34,211,238,0.25), transparent 70%)" }}
        />
        <p className="label-caps mb-3">The house has data.</p>
        <h3 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          NOW <span className="text-primary" style={{ textShadow: "0 0 24px rgba(34,211,238,0.4)" }}>YOU</span> DO TOO.
        </h3>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Proprietary quantitative models. Real-time sportsbook markets.
          Advanced AI intelligence. One platform built to help bettors make
          smarter, data-driven decisions.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/picks"
            className="rounded-sm bg-primary px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            VIEW TODAY'S PICKS
          </Link>
          {isPro ? (
            <Link
              to="/account"
              className="rounded-sm border border-warn/50 px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-warn transition-colors hover:bg-warn-dim"
            >
              PRO PLAN ACTIVE
            </Link>
          ) : (
            <Link
              to="/premium"
              className="rounded-sm border border-primary/50 px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary transition-colors hover:bg-live-dim"
            >
              GO PRO
            </Link>
          )}
        </div>
        <p className="mx-auto mt-8 max-w-2xl font-mono2 text-[9px] leading-relaxed text-muted-foreground/70">
          Our platform provides sports analytics and informational tools only
          and does not accept or place wagers. Predictions and model outputs are
          probabilistic and do not guarantee future results. Sports betting
          involves risk. Please wager responsibly.
        </p>
      </section>
    </div>
  );
}
