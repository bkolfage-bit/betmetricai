import { useEffect, useRef, useState } from "react";
import { SectionHead } from "@/components/bits";
import { cn } from "@/lib/utils";
import { Bot, Send, TriangleAlert, User } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED = [
  "What is the best NFL bet right now?",
  "Why did the Chiefs pick change?",
  "Find me a +EV position with at least a 5% edge.",
  "Which sportsbook has the best price on the board?",
  "Explain the difference between prediction and betting value.",
  "Build a 3-leg parlay around +600.",
];

export default function Assistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<{ kind: string; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        const kind = body?.kind ?? "AiTransient";
        throw Object.assign(new Error(body?.error ?? "AI analysis temporarily unavailable."), { kind });
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          acc += decoder.decode(value, { stream: !done });
          const snapshot = acc;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: snapshot };
            return copy;
          });
        }
      }
      if (!acc) throw new Error("AI analysis temporarily unavailable.");
    } catch (e) {
      const err = e as Error & { kind?: string };
      setMessages((prev) => prev.slice(0, -1));
      setError({
        kind: err.kind ?? "AiTransient",
        text:
          err.kind === "AiUnavailable"
            ? "AI quota exhausted — this feature is unavailable until the site owner tops up. The quantitative board above keeps working."
            : err.message || "AI analysis temporarily unavailable.",
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <SectionHead
        title="Ask the AI"
        sub="The AI assistant reads the verified platform snapshot — odds, probabilities, edges and pick history — and explains it. It never invents numbers."
      />

      <div className="panel flex min-h-[480px] flex-col rounded-sm">
        {/* messages */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-live-dim">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-mono2 text-xs font-bold tracking-[0.16em]">BETMETRIC AI ANALYST</p>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Ask anything about the current board. Answers are grounded in the
                  verified quantitative feed — never in the model's imagination.
                </p>
              </div>
              <div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="min-h-[44px] rounded-sm border border-border px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-live-dim">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-sm px-3.5 py-2.5 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border-l-2 border-primary/50 bg-secondary text-foreground",
                )}
              >
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </div>
              {m.role === "user" && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {error && (
            <div className="flex items-start gap-2 rounded-sm border border-[#fbbf24]/40 bg-warn-dim px-3.5 py-2.5 text-xs text-warn">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error.text}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2 border-t border-border p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about today's board, edges, line moves…"
            className="min-h-[44px] flex-1 rounded-sm border border-border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      <p className="font-mono2 text-[10px] leading-relaxed text-muted-foreground">
        * The assistant explains verified platform data only. It cannot invent odds,
        injuries, probabilities or records. AI usage is metered to the site owner.
        Nothing the AI says is a guarantee — betting involves substantial risk.
      </p>
    </div>
  );
}
