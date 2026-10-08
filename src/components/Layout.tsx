import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { DataSourceBadge, Freshness } from "@/components/bits";
import { useFeedStatus } from "@/hooks/use-feed-status";
import { SportFilter } from "@/components/SportFilter";
import { useSportFilter } from "@/providers/sport-filter";
import { fmtLine, fmtOdds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Activity,
  BarChart3,
  Bot,
  CircleUser,
  Crosshair,
  Dices,
  Home,
  Info,
  LayoutGrid,
  LogIn,
  Radio,
  Scale,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";

const NAV_BASE = [
  { to: "/", label: "HOME" },
  { to: "/picks", label: "PICKS" },
  { to: "/live", label: "LIVE" },
  { to: "/ev", label: "+EV" },
  { to: "/props", label: "PROPS" },
  { to: "/parlays", label: "PARLAYS" },
  { to: "/line-movement", label: "LINE MOVEMENT" },
  { to: "/markets", label: "PRED MKTS" },
  { to: "/assistant", label: "AI ASSISTANT" },
  { to: "/tracker", label: "BET TRACKER" },
  { to: "/performance", label: "PERFORMANCE" },
];

/** Model internals (/sports) are admin-only — see AdminGate. */
const NAV_ADMIN = [{ to: "/sports", label: "SPORTS" }];

/** Top-nav items; the /premium entry reads as PLAN once the user is PRO. */
function navFor(plan?: string, role?: string) {
  return [
    ...NAV_BASE,
    ...(role === "admin" ? NAV_ADMIN : []),
    { to: "/premium", label: plan === "pro" ? "PLAN" : "PREMIUM" },
  ];
}

const MOBILE_NAV = [
  { to: "/", label: "HOME", icon: Home },
  { to: "/picks", label: "PICKS", icon: Crosshair },
  { to: "/live", label: "LIVE", icon: Radio },
  { to: "/ev", label: "+EV", icon: Activity },
  { to: "/tracker", label: "TRACKER", icon: Wallet },
] as const;

/** Everything beyond the bottom bar — surfaced through the mobile MENU sheet. */
const MOBILE_MENU_SECTIONS = [
  {
    title: "CORE",
    items: [
      { to: "/", label: "Home", icon: Home, pro: false },
      { to: "/picks", label: "AI Picks", icon: Crosshair, pro: false },
      { to: "/live", label: "Live Scores & Odds", icon: Radio, pro: false },
      { to: "/ev", label: "+EV Opportunities", icon: Activity, pro: false },
      { to: "/sports", label: "Sports & Models", icon: Trophy, pro: false },
      { to: "/markets", label: "Prediction Markets", icon: Scale, pro: false },
    ],
  },
  {
    title: "PRO FEATURES",
    items: [
      { to: "/props", label: "Player Props", icon: Target, pro: true },
      { to: "/parlays", label: "AI Parlay Builder", icon: Dices, pro: true },
      { to: "/line-movement", label: "Line Movement", icon: TrendingUp, pro: true },
      { to: "/assistant", label: "AI Assistant", icon: Bot, pro: true },
      { to: "/tracker", label: "Bet Tracker & Bankroll", icon: Wallet, pro: true },
      { to: "/performance", label: "Performance & CLV", icon: BarChart3, pro: true },
    ],
  },
  {
    title: "ACCOUNT",
    items: [
      { to: "/account", label: "My Account", icon: CircleUser, pro: false },
      { to: "/about", label: "About / How It Works", icon: Info, pro: false },
    ],
  },
] as const;

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
  const items = (data?.picks ?? [])
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
        <span className="rounded-sm border border-border px-1 py-px text-[9px] font-bold tracking-[0.1em] text-muted-foreground">
          {p.sportCode}
        </span>
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
    <div className="relative overflow-hidden border-t border-border/60 bg-card/60 py-1.5">
      <div className="ticker-track">
        {chips}
        {chips}
      </div>
    </div>
  );
}

/** Full-feature mobile menu: every pro feature, auth state, and plan badge. */
function MobileMenu() {
  const [open, setOpen] = useState(false);
  const { user, isLoading } = useAuth();
  const location = useLocation();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex min-h-[56px] flex-col items-center justify-center gap-1 font-mono2 text-[8px] tracking-[0.12em] text-muted-foreground"
          aria-label="Open full menu"
        >
          <LayoutGrid size={18} />
          MENU
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-lg border-border bg-card px-0 pb-[calc(env(safe-area-inset-bottom)+16px)]"
      >
        <SheetTitle className="sr-only">Full menu</SheetTitle>
        <div className="mx-auto w-full max-w-lg">
          {/* auth strip — makes sign-in state obvious on mobile */}
          <div className="border-b border-border/60 px-5 pb-4 pt-1 pr-12">
            {isLoading ? (
              <div className="h-12 animate-pulse rounded-sm bg-background/60" />
            ) : user ? (
              <Link
                to="/account"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-sm border border-border bg-background/50 p-3"
              >
                <CircleUser className="h-8 w-8 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user.name ?? "Account"}</p>
                  <p className="font-mono2 text-[9px] tracking-[0.16em] text-muted-foreground">
                    {user.plan === "pro" ? (
                      <span className="text-warn">PRO PLAN · ALL FEATURES UNLOCKED</span>
                    ) : (
                      "FREE PLAN"
                    )}
                  </p>
                </div>
                {user.role === "admin" && <Shield className="h-4 w-4 text-warn" />}
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">You're not signed in</p>
                  <p className="truncate font-mono2 text-[9px] tracking-[0.12em] text-muted-foreground">
                    SIGN IN FOR TRACKER & PRO ACCESS
                  </p>
                </div>
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="flex shrink-0 items-center gap-1.5 rounded-sm bg-primary px-3 py-2 font-mono2 text-[10px] font-bold tracking-[0.12em] text-primary-foreground"
                >
                  <LogIn className="h-3.5 w-3.5" /> SIGN IN
                </Link>
              </div>
            )}
          </div>

          {/* feature sections */}
          {MOBILE_MENU_SECTIONS.map((sec) => {
            const items = [
              // model internals are admin-only
              ...sec.items.filter(
                (i) => i.to !== "/sports" || user?.role === "admin",
              ),
              ...(sec.title === "ACCOUNT"
                ? [
                    {
                      to: "/premium",
                      label: user?.plan === "pro" ? "Plan & Billing" : "Go Pro",
                      icon: Sparkles,
                      pro: false,
                    } as const,
                  ]
                : []),
            ];
            return (
            <div key={sec.title} className="px-5 pt-4">
              <p className="label-caps mb-2 flex items-center gap-2">
                {sec.title}
                {sec.title === "PRO FEATURES" && (
                  <Sparkles className="h-3 w-3 text-warn" />
                )}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.to === "/"
                      ? location.pathname === "/"
                      : location.pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-sm border p-2.5 text-xs transition-colors",
                        active
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border/70 bg-background/40 text-foreground hover:border-primary/40",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                      {item.pro && (
                        <span className="rounded-sm border border-warn/50 px-1 py-px font-mono2 text-[7px] font-bold tracking-[0.1em] text-warn">
                          PRO
                        </span>
                      )}
                    </Link>
                  );
                })}
                {sec.title === "ACCOUNT" && user?.role === "admin" && (
                  <Link
                    to="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-sm border border-border/70 bg-background/40 p-2.5 text-xs text-foreground hover:border-primary/40"
                  >
                    <Shield className="h-4 w-4 shrink-0 text-warn" />
                    <span className="min-w-0 flex-1 truncate font-medium">Admin Console</span>
                  </Link>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Layout() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const { data: fresh } = trpc.odds.freshness.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const feed = useFeedStatus();
  const feedDegraded =
    feed.mode === "live" &&
    feed.health.some((h) => h.status === "degraded" || h.status === "offline");

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-50 border-b border-border glass">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-3 sm:gap-4 sm:px-5">
          <Logo />
          <nav className="hidden h-14 flex-1 items-stretch gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden">
            {navFor(user?.plan, user?.role).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center whitespace-nowrap border-b-2 px-2.5 font-mono2 text-[10px] font-semibold tracking-[0.14em] transition-colors",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
            <SportFilter />
            <span className="hidden sm:inline-flex">
              <DataSourceBadge mode={feed.mode} degraded={feedDegraded} />
            </span>
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
                  className="rounded-sm bg-primary px-2.5 py-1.5 font-mono2 text-[10px] font-bold tracking-[0.1em] text-primary-foreground transition-transform hover:scale-[1.03] sm:px-3 sm:tracking-[0.14em]"
                >
                  SIGN IN
                </Link>
              ))}
          </div>
        </div>
      </header>

      {/* mobile/tablet: full section nav — swipeable strip mirroring the desktop top nav */}
      <nav className="border-b border-border/60 bg-card/40 lg:hidden">
        <div className="mx-auto flex max-w-[1500px] items-stretch gap-0.5 overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navFor(user?.plan, user?.role).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex min-h-[40px] items-center whitespace-nowrap border-b-2 px-2.5 font-mono2 text-[9px] font-semibold tracking-[0.12em] transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* meta strip: freshness (always) + ticker (desktop only) */}
      <div className="border-b border-border/60 bg-background/60">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-3 py-1 sm:px-5">
          <Freshness at={fresh?.lastOddsAt ?? null} live={location.pathname === "/live"} />
          <span className="flex items-center gap-3">
            <span className="sm:hidden">
              <DataSourceBadge mode={feed.mode} degraded={feedDegraded} />
            </span>
            <span className="hidden font-mono2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              10 SPORTS · QUANT ENSEMBLES
            </span>
          </span>
        </div>
        <div className="hidden lg:block">
          <Ticker />
        </div>
      </div>

      {/* content */}
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 pb-24 pt-7 sm:px-5 lg:pb-12">
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
              <Link to="/about" className="hover:text-foreground">About / How It Works</Link>
              <Link to="/picks" className="hover:text-foreground">AI Picks</Link>
              <Link to="/ev" className="hover:text-foreground">+EV Opportunities</Link>
              <Link to="/performance" className="hover:text-foreground">AI Performance</Link>
              <Link to="/assistant" className="hover:text-foreground">AI Assistant</Link>
            </div>
          </div>
          <div>
            <p className="label-caps mb-3">Account</p>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <Link to="/premium" className="hover:text-foreground">
                {user?.plan === "pro" ? "Plan & Billing" : "Go Pro"}
              </Link>
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
            © 2026 BetMetricAi · Odds: The Odds API (production feed) ·
            Predictions: quantitative models
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
        <MobileMenu />
      </nav>
    </div>
  );
}
