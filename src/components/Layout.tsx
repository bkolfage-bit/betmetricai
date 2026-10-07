import { Link, NavLink, Outlet, useLocation } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { DemoBadge, Freshness } from "@/components/bits";
import { SportFilter } from "@/components/SportFilter";
import { useSportFilter } from "@/providers/sport-filter";
import { fmtLine, fmtOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Activity,
  CircleUser,
  Crosshair,
  Home,
  Radio,
  Shield,
  Wallet,
} from "lucide-react";

const NAV = [
  { to: "/", label: "HOME" },
  { to: "/picks", label: "PICKS" },
  { to: "/live", label: "LIVE" },
  { to: "/ev", label: "+EV" },
  { to: "/props", label: "PROPS" },
  { to: "/parlays", label: "PARLAYS" },
  { to: "/line-movement", label: "LINE MOVEMENT" },
  { to: "/sports", label: "SPORTS" },
  { to: "/assistant", label: "AI ASSISTANT" },
  { to: "/tracker", label: "BET TRACKER" },
  { to: "/performance", label: "PERFORMANCE" },
  { to: "/premium", label: "PREMIUM" },
];

const MOBILE_NAV = [
  { to: "/", label: "HOME", icon: Home },
  { to: "/picks", label: "PICKS", icon: Crosshair },
  { to: "/live", label: "LIVE", icon: Radio },
  { to: "/ev", label: "+EV", icon: Activity },
  { to: "/tracker", label: "TRACKER", icon: Wallet },
  { to: "/account", label: "ACCOUNT", icon: CircleUser },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      {/* radar mark */}
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-primary/50" />
        <span className="absolute inset-[5px] rounded-full border border-primary/30" />
        <span className="led led-live" />
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(34,211,238,0.5), transparent 90deg)",
            animation: "radar-sweep 4.2s linear infinite",
          }}
        />
      </span>
      <span className="font-mono2 text-sm font-extrabold tracking-[0.12em]">
        BETMETRIC<span className="text-primary">.AI</span>
      </span>
      <style>{`@keyframes radar-sweep { to { transform: rotate(360deg); } }`}</style>
    </Link>
  );
}

function Ticker() {
  const { data } = trpc.picks.list.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const { isVisible } = useSportFilter();
  const items = (data ?? [])
    .filter((p) => p.version && p.version.status !== "PASS" && isVisible(p.sportCode))
    .slice(0, 10);
  if (items.length === 0) return null;
  const chips = items.map((p) => {
    const sel =
      p.pick.market === "moneyline"
        ? `${p.pick.selection === "home" ? p.home.abbr : p.away.abbr} ML`
        : p.pick.market === "spread"
          ? `${p.pick.selection === "home" ? p.home.abbr : p.away.abbr} ${fmtLine(p.version!.line)}`
          : `${p.pick.selection === "over" ? "O" : "U"}${p.version!.line}`;
    return (
      <span key={p.pick.id} className="mx-5 inline-flex items-center gap-2 font-mono2 text-[11px]">
        <span className="text-muted-foreground">{p.away.abbr}@{p.home.abbr}</span>
        <span className="font-bold text-foreground">{sel}</span>
        <span className="text-pos">{fmtOdds(p.version!.odds)}</span>
        <span className="text-muted-foreground">EDGE</span>
        <span className="font-bold text-primary">{p.version!.edgeScore}</span>
        <span className="text-muted-foreground/50">▪</span>
      </span>
    );
  });
  return (
    <div className="relative overflow-hidden border-b border-border bg-card/60 py-1.5">
      <div className="ticker-track">
        {chips}
        {chips}
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const { data: fresh } = trpc.odds.freshness.useQuery(undefined, {
    refetchInterval: 15000,
  });

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-50 border-b border-border glass">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-4 px-3 sm:px-5">
          <Logo />
          <nav className="hidden flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap px-2.5 py-2 font-mono2 text-[10px] font-semibold tracking-[0.14em] transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <DemoBadge />
            {!isLoading &&
              (user ? (
                <Link
                  to="/account"
                  className="flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 font-mono2 text-[10px] tracking-[0.12em] text-foreground hover:border-primary/50"
                >
                  {user.role === "admin" && <Shield className="h-3 w-3 text-warn" />}
                  <CircleUser className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden sm:inline">{user.name ?? "ACCOUNT"}</span>
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="rounded-sm bg-primary px-3 py-1.5 font-mono2 text-[10px] font-bold tracking-[0.14em] text-primary-foreground transition-transform hover:scale-[1.03]"
                >
                  SIGN IN
                </Link>
              ))}
          </div>
        </div>
        <Ticker />
      </header>

      {/* freshness + global sport filter strip */}
      <div className="border-b border-border/60 bg-background/60">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-3 py-1.5 sm:px-5">
          <Freshness at={fresh?.lastOddsAt ?? null} live={location.pathname === "/live"} />
          <div className="min-w-0 flex-1">
            <SportFilter compact />
          </div>
        </div>
      </div>

      {/* content */}
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 pb-24 pt-6 sm:px-5 lg:pb-10">
        <Outlet />
      </main>

      {/* footer */}
      <footer className="border-t border-border bg-card/40 pb-20 lg:pb-0">
        <div className="mx-auto grid max-w-[1500px] gap-8 px-5 py-10 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Real-time sportsbook odds, quantitative predictions, expected-value
              analysis and AI betting intelligence. The pick changes when the
              market changes.
            </p>
          </div>
          <div>
            <p className="label-caps mb-3">Platform</p>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <Link to="/picks" className="hover:text-foreground">AI Picks</Link>
              <Link to="/ev" className="hover:text-foreground">+EV Opportunities</Link>
              <Link to="/performance" className="hover:text-foreground">AI Performance</Link>
              <Link to="/assistant" className="hover:text-foreground">AI Assistant</Link>
            </div>
          </div>
          <div>
            <p className="label-caps mb-3">Account</p>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <Link to="/premium" className="hover:text-foreground">Go Pro</Link>
              <Link to="/tracker" className="hover:text-foreground">Bet Tracker</Link>
              <Link to="/account" className="hover:text-foreground">Account</Link>
              {user?.role === "admin" && (
                <Link to="/admin" className="hover:text-foreground">Admin Console</Link>
              )}
            </div>
          </div>
          <div>
            <p className="label-caps mb-3">Responsible gambling</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              21+. Betting involves substantial risk. Nothing on this platform is a
              guarantee of profit or outcome. Never wager more than you can afford
              to lose. If you have a gambling problem, call or text
              <span className="text-foreground"> 1-800-GAMBLER</span>.
            </p>
          </div>
        </div>
        <div className="hairline-t mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-5 py-4">
          <p className="font-mono2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            © 2026 BetMetricAi · All displayed data is simulated DEMO DATA through the live pipeline
          </p>
          <p className="font-mono2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Prediction ≠ betting value
          </p>
        </div>
      </footer>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t border-border glass pb-[env(safe-area-inset-bottom)] lg:hidden">
        {MOBILE_NAV.map((n) => {
          const Icon = n.icon;
          const active = n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex min-h-[56px] flex-col items-center justify-center gap-1 font-mono2 text-[8px] tracking-[0.12em]",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-4.5 w-4.5" size={18} />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
