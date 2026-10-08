import { Link } from "react-router";
import { Lock, Sparkles } from "lucide-react";

/**
 * Pro teaser overlay — wraps a page's data area for FREE visitors: the real
 * layout renders underneath but is blurred and non-interactive, with a
 * floating upgrade card on top. Pro/admin users never see it (the parent
 * only mounts it for non-pro). Everything outside the wrapper — headers,
 * descriptions, footnotes, controls — stays fully visible.
 */
export function ProTeaser({
  children,
  title = "This data is part of Pro",
  sub = "Upgrade to see every number on this page — unblurred and updating live.",
}: {
  children: React.ReactNode;
  title?: string;
  sub?: string;
}) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none select-none blur-[6px] saturate-[0.6]"
      >
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 p-6">
        <div className="panel w-full max-w-sm rounded-sm p-6 text-center shadow-[0_0_60px_rgba(34,211,238,0.12)]">
          <Lock className="mx-auto h-5 w-5 text-warn" />
          <p className="mt-3 text-base font-extrabold tracking-tight">{title}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{sub}</p>
          <Link
            to="/premium"
            className="mt-5 flex items-center justify-center gap-2 rounded-sm bg-primary px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            <Sparkles className="h-3.5 w-3.5" /> UPGRADE TO PRO
          </Link>
          <p className="mt-3 font-mono2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            $19.99/mo or $199/yr — cancel anytime
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Full pro gate — for pages where there is nothing meaningful to tease
 * (e.g. an interactive builder with no data until you use it). Shows the
 * page header (parent renders it) plus a single blocked panel.
 */
export function ProGate({
  title,
  sub,
}: {
  title: string;
  sub: string;
}) {
  return (
    <div className="panel relative overflow-hidden rounded-sm px-6 py-14 text-center">
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{ background: "radial-gradient(500px 200px at 50% 0%, rgba(34,211,238,0.25), transparent 70%)" }}
      />
      <Lock className="mx-auto h-6 w-6 text-warn" />
      <p className="mt-4 text-xl font-extrabold tracking-tight">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{sub}</p>
      <Link
        to="/premium"
        className="mt-6 inline-flex items-center gap-2 rounded-sm bg-primary px-8 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.03]"
      >
        <Sparkles className="h-3.5 w-3.5" /> UPGRADE TO PRO
      </Link>
      <p className="mt-3 font-mono2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        $19.99/mo or $199/yr — cancel anytime
      </p>
    </div>
  );
}
