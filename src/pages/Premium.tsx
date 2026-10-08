import { Link } from "react-router";
import { SectionHead } from "@/components/bits";
import { cn } from "@/lib/utils";
import { Check, Minus, Sparkles } from "lucide-react";

const FREE = [
  "2 AI picks per sport",
  "AI Edge ratings up to 90",
  "Basic odds board",
  "Live scores",
  "Basic bet tracker",
];
const PRO = [
  "Unlimited AI picks + full AI Edge",
  "Player props & +EV screen",
  "Line movement history",
  "Live betting model",
  "AI assistant (unlimited)",
  "AI parlay builder",
  "Real-time alerts",
  "Advanced bet tracker & bankroll analytics",
  "Full historical performance & CLV",
];

const PLANS = [
  {
    name: "FREE",
    price: "$0",
    period: "forever",
    features: FREE,
    cta: "CURRENT PLAN",
    highlight: false,
  },
  {
    name: "PRO",
    price: "$19.99",
    period: "/month",
    features: PRO,
    cta: "GO PRO",
    highlight: true,
  },
  {
    name: "PRO ANNUAL",
    price: "$199",
    period: "/year",
    features: [...PRO, "2 months free vs monthly"],
    cta: "GO ANNUAL",
    highlight: false,
  },
];

export default function Premium() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      {/* beta access notice — billing not yet connected, access is admin-granted */}
      <div className="panel flex flex-wrap items-center justify-between gap-4 rounded-sm border-[#fbbf24]/40 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div>
            <p className="font-mono2 text-xs font-bold tracking-[0.16em] text-warn">
              BETA — PRO ACCESS IS GRANTED BY INVITE
            </p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
              Billing is not connected yet. Create a free account, then ask the
              platform admin to activate PRO on it — it unlocks instantly.
            </p>
          </div>
        </div>
        <Link
          to="/login"
          className="min-h-[44px] rounded-sm bg-[#fbbf24] px-5 py-3 font-mono2 text-[11px] font-bold tracking-[0.14em] text-[#050810] transition-transform hover:scale-[1.02]"
        >
          CREATE FREE ACCOUNT
        </Link>
      </div>

      <div className="text-center">
        <p className="label-caps mb-3">Premium</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          THE FULL TERMINAL, <span className="text-primary">UNLOCKED</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          Free users see the surface. Pro users see the whole machine: every edge,
          every version, every live window — plus the AI analyst on call.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={cn(
              "panel relative flex flex-col rounded-sm p-6",
              p.highlight && "border-primary/60",
            )}
            style={p.highlight ? { boxShadow: "0 0 32px rgba(34,211,238,0.12)" } : undefined}
          >
            {p.highlight && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-sm bg-primary px-2 py-0.5 font-mono2 text-[9px] font-bold tracking-[0.16em] text-primary-foreground">
                MOST POPULAR
              </span>
            )}
            <p className="font-mono2 text-xs font-bold tracking-[0.2em]">{p.name}</p>
            <p className="mt-3">
              <span className="font-mono2 text-3xl font-extrabold tabular-nums">{p.price}</span>
              <span className="ml-1 font-mono2 text-xs text-muted-foreground">{p.period}</span>
            </p>
            <ul className="mt-5 flex flex-1 flex-col gap-2">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pos" />
                  {f}
                </li>
              ))}
            </ul>
            {p.name === "FREE" ? (
              <button
                className="mt-6 min-h-[44px] rounded-sm border border-border font-mono2 text-[11px] font-bold tracking-[0.16em] text-muted-foreground"
                disabled
              >
                {p.cta}
              </button>
            ) : (
              <Link
                to="/login"
                className={cn(
                  "mt-6 flex min-h-[44px] items-center justify-center rounded-sm font-mono2 text-[11px] font-bold tracking-[0.16em]",
                  p.highlight
                    ? "bg-primary text-primary-foreground transition-transform hover:scale-[1.02]"
                    : "border border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {p.cta}
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* comparison */}
      <section>
        <SectionHead title="Free vs Pro" />
        <div className="panel overflow-x-auto rounded-sm">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="label-caps px-4 py-3 text-left font-normal">Feature</th>
                <th className="label-caps px-4 py-3 text-center font-normal">Free</th>
                <th className="label-caps px-4 py-3 text-center font-normal text-primary">Pro</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["AI picks", "2 per sport", "Unlimited"],
                ["AI Edge Score", "Up to 90", "Full 0–100 + history"],
                ["Player props", false, true],
                ["+EV screen", false, true],
                ["Line movement", false, true],
                ["Live betting model", false, true],
                ["AI assistant", "3 questions/day", "Unlimited"],
                ["AI parlay builder", false, true],
                ["Alerts", false, true],
                ["Bet tracker", "Basic", "Advanced + bankroll"],
              ].map(([f, free, pro]) => (
                <tr key={f as string} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{f}</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">
                    {free === false ? <Minus className="mx-auto h-3.5 w-3.5" /> : free === true ? <Check className="mx-auto h-3.5 w-3.5 text-pos" /> : free}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {pro === false ? <Minus className="mx-auto h-3.5 w-3.5" /> : pro === true ? <Check className="mx-auto h-3.5 w-3.5 text-pos" /> : pro}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-center font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        Billing activates when the Stripe integration is connected (checkout,
        customer portal, trials, coupons, webhooks). Card data never touches this
        platform — Stripe handles all of it. An ELITE tier is reserved in the plan
        architecture. Cancel anytime.
      </p>
    </div>
  );
}
