import { Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { SectionHead } from "@/components/bits";
import { fmtTime } from "@/lib/format";
import { CircleUser, LogOut, Shield } from "lucide-react";

export default function Account() {
  const { user, isLoading, logout } = useAuth();

  if (!isLoading && !user) {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <p className="label-caps mb-3">Account</p>
        <h2 className="text-2xl font-extrabold">YOU'RE NOT SIGNED IN</h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/login"
            className="rounded-sm bg-primary px-8 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground"
          >
            SIGN IN WITH KIMI
          </Link>
          <a
            href="/api/auth/demo-pro"
            className="rounded-sm border border-[#fbbf24]/50 px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.14em] text-warn"
          >
            PREVIEW PRO — DEMO
          </a>
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <SectionHead title="Account" />
      <div className="panel flex flex-wrap items-center gap-4 rounded-sm p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-live-dim">
          <CircleUser className="h-7 w-7 text-primary" />
        </div>
        <div className="flex-1">
          <p className="flex items-center gap-2 text-lg font-bold">
            {user.name ?? "Bettor"}
            {user.role === "admin" && (
              <span className="flex items-center gap-1 rounded-sm border border-[#fbbf24]/40 bg-warn-dim px-1.5 py-0.5 font-mono2 text-[9px] font-bold text-warn">
                <Shield className="h-3 w-3" /> ADMIN
              </span>
            )}
          </p>
          <p className="font-mono2 text-xs text-muted-foreground">{user.email ?? "—"}</p>
          <p className="mt-1 font-mono2 text-[10px] text-muted-foreground">
            Member since {fmtTime(user.createdAt)} · last sign-in {fmtTime(user.lastSignInAt)}
          </p>
        </div>
        <button
          onClick={() => logout()}
          className="flex min-h-[44px] items-center gap-2 rounded-sm border border-border px-4 font-mono2 text-[10px] font-bold tracking-[0.14em] text-muted-foreground hover:border-[#f87171]/50 hover:text-neg"
        >
          <LogOut className="h-3.5 w-3.5" /> SIGN OUT
        </button>
      </div>

      {user.unionId === "demo-pro-preview" && (
        <div className="rounded-sm border border-[#fbbf24]/40 bg-warn-dim px-4 py-3 font-mono2 text-[11px] leading-relaxed text-warn">
          DEMO PRO PREVIEW — you are browsing the paid experience with a demo account.
          No billing involved. Sign out to leave the demo.
        </div>
      )}

      <div className="panel rounded-sm p-6">
        <p className="label-caps mb-3">Subscription</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono2 text-sm font-bold uppercase tracking-[0.14em]">
              {user.plan === "pro" ? "PRO" : "FREE"} PLAN
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.plan === "pro"
                ? "Full terminal access. Manage billing in the Stripe customer portal once billing is connected."
                : "Upgrade to unlock the full terminal: unlimited picks, props, +EV, live model, AI assistant and alerts."}
            </p>
          </div>
          {user.plan !== "pro" && (
            <Link
              to="/premium"
              className="min-h-[44px] rounded-sm bg-primary px-6 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground"
            >
              GO PRO
            </Link>
          )}
        </div>
      </div>

      {user.role === "admin" && (
        <Link to="/admin" className="panel flex items-center justify-between rounded-sm p-5 transition-colors hover:border-[#fbbf24]/50">
          <div>
            <p className="font-mono2 text-xs font-bold tracking-[0.16em] text-warn">ADMIN CONSOLE</p>
            <p className="mt-1 text-xs text-muted-foreground">Users, thresholds, feeds, model controls and system logs.</p>
          </div>
          <Shield className="h-5 w-5 text-warn" />
        </Link>
      )}

      <div className="panel rounded-sm border-dashed p-5">
        <p className="label-caps mb-2">Responsible gambling</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Set deposit limits with your sportsbook, never chase losses, and treat
          betting as entertainment — not income. If gambling stops being fun, call
          or text 1-800-GAMBLER (US) for free, confidential help 24/7.
        </p>
      </div>
    </div>
  );
}
