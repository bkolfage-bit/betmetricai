import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { CircleUser, KeyRound, Mail, Sparkles } from "lucide-react";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const utils = trpc.useUtils();

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      navigate("/account");
    },
    onError: (e) => setError(e.message),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      navigate("/account");
    },
    onError: (e) => setError(e.message),
  });
  const pending = login.isPending || register.isPending;

  if (!isLoading && user) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <p className="label-caps mb-3">Signed in</p>
        <h2 className="text-2xl font-extrabold">WELCOME BACK</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You're signed in as {user.name ?? user.email ?? "your account"}.
        </p>
        <Link
          to="/account"
          className="mt-6 inline-block rounded-sm bg-primary px-8 py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground"
        >
          GO TO ACCOUNT
        </Link>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signin") {
      login.mutate({ email, password });
    } else {
      register.mutate({ name: name.trim() || email.split("@")[0], email, password });
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 pt-10">
      <div className="text-center">
        <p className="label-caps mb-3">BetMetric.AI Account</p>
        <h2 className="text-2xl font-extrabold">
          {mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {mode === "signin"
            ? "Access your picks, tracker and plan."
            : "Free account — upgrade to PRO anytime."}
        </p>
      </div>

      {/* mode toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-sm border border-border bg-card p-1">
        {(["signin", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "rounded-sm py-2 font-mono2 text-[10px] font-bold tracking-[0.14em] transition-colors",
              mode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "signin" ? "SIGN IN" : "REGISTER"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="panel flex flex-col gap-4 rounded-sm p-6">
        {mode === "register" && (
          <label className="flex flex-col gap-1.5">
            <span className="font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground">
              DISPLAY NAME
            </span>
            <div className="flex items-center gap-2 rounded-sm border border-border bg-background px-3">
              <CircleUser className="h-4 w-4 text-muted-foreground" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={120}
                className="w-full bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground">
            EMAIL
          </span>
          <div className="flex items-center gap-2 rounded-sm border border-border bg-background px-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-transparent py-2.5 text-sm outline-none"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground">
            PASSWORD
          </span>
          <div className="flex items-center gap-2 rounded-sm border border-border bg-background px-3">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
              className="w-full bg-transparent py-2.5 text-sm outline-none"
            />
          </div>
        </label>

        {error && (
          <p className="rounded-sm border border-neg/40 bg-neg/10 px-3 py-2 text-xs text-neg">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-primary py-3 font-mono2 text-[11px] font-bold tracking-[0.16em] text-primary-foreground transition-transform hover:scale-[1.01] disabled:opacity-50"
        >
          {pending
            ? "WORKING…"
            : mode === "signin"
              ? "SIGN IN"
              : "CREATE FREE ACCOUNT"}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-center font-mono2 text-[9px] tracking-[0.1em] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-warn" />
          FREE: 2 PICKS PER SPORT · PRO: EVERYTHING, FULL AI EDGE
        </p>
      </form>
    </div>
  );
}
