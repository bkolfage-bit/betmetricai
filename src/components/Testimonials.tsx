import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, MessageSquareQuote, Star } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * Testimonial carousel — shows ONLY genuine, admin-approved customer reviews
 * from the database. No sample or illustrative copy anywhere: until the
 * first real review is approved, the section shows an honest empty state
 * inviting customers to be the first to leave one.
 */

function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i < n ? "fill-[#fbbf24] text-[#fbbf24]" : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

function ReviewForm() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: mine } = trpc.testimonials.mine.useQuery(undefined, { enabled: !!user });
  const submit = trpc.testimonials.submit.useMutation({
    onSuccess: () => {
      utils.testimonials.mine.invalidate();
      setDone(true);
    },
  });
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");

  if (!user) {
    return (
      <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Used BetMetricAi?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in to leave a review
        </Link>
      </p>
    );
  }

  const existing = mine?.review;
  if (existing) {
    return (
      <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Your review is{" "}
        <b className={existing.status === "approved" ? "text-pos" : existing.status === "rejected" ? "text-neg" : "text-warn"}>
          {existing.status === "approved" ? "published" : existing.status === "rejected" ? "not published" : "awaiting moderation"}
        </b>{" "}
        — thank you for the feedback.
      </p>
    );
  }

  if (done) {
    return (
      <p className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-pos">
        Review submitted — it will appear here once our team approves it.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-sm border border-primary/50 px-4 py-2 font-mono2 text-[10px] font-bold tracking-[0.14em] text-primary transition-colors hover:bg-primary/10"
      >
        LEAVE A REVIEW
      </button>
    );
  }

  return (
    <form
      className="panel flex w-full max-w-xl flex-col gap-3 rounded-sm p-5 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({ displayName: name, rating, text });
      }}
    >
      <p className="label-caps">Your review — published after moderation</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name (e.g. Mike D.)"
        maxLength={64}
        required
        className="rounded-sm border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      <div className="flex items-center gap-2">
        <span className="font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Rating:</span>
        {Array.from({ length: 5 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setRating(i + 1)}
            aria-label={`${i + 1} stars`}
            className="p-0.5"
          >
            <Star
              className={cn(
                "h-5 w-5 transition-colors",
                i < rating ? "fill-[#fbbf24] text-[#fbbf24]" : "text-muted-foreground/40 hover:text-[#fbbf24]",
              )}
            />
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What do you like about the platform? (10–1000 characters)"
        minLength={10}
        maxLength={1000}
        rows={3}
        required
        className="rounded-sm border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {submit.error && (
        <p className="font-mono2 text-[10px] text-neg">{submit.error.message}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submit.isPending}
          className="rounded-sm bg-primary px-5 py-2 font-mono2 text-[10px] font-bold tracking-[0.14em] text-primary-foreground disabled:opacity-50"
        >
          {submit.isPending ? "SUBMITTING…" : "SUBMIT REVIEW"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono2 text-[10px] tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}

export function Testimonials() {
  const { data } = trpc.testimonials.list.useQuery();
  const reviews = data?.reviews ?? [];
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };
  useEffect(() => {
    updateArrows();
    window.addEventListener("resize", updateArrows);
    return () => window.removeEventListener("resize", updateArrows);
  }, [reviews.length]);

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const w = card ? card.offsetWidth + 16 : el.clientWidth;
    el.scrollBy({ left: dir * w, behavior: "smooth" });
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="label-caps mb-3 flex items-center gap-2">
            <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
            Verified customer reviews
          </p>
          <h2 className="text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl">
            BUILT FOR BETTORS WHO <span className="text-primary">WANT AN EDGE</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            See why data-driven bettors are excited about a smarter way to
            analyze sports, compare odds, and discover potential betting value.
          </p>
        </div>
        {reviews.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll(-1)}
              disabled={!canLeft}
              aria-label="Scroll testimonials left"
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scroll(1)}
              disabled={!canRight}
              aria-label="Scroll testimonials right"
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* carousel: 3 cards desktop · 2 tablet · 1 mobile · touch swipe native */}
      {reviews.length > 0 ? (
        <div
          ref={trackRef}
          onScroll={updateArrows}
          className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {reviews.map((r) => (
            <figure
              key={r.id}
              data-card
              className="panel flex w-full shrink-0 snap-start flex-col rounded-sm p-5 sm:w-[calc(50%-8px)] lg:w-[calc(33.333%-11px)]"
            >
              <Stars n={r.rating} />
              <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-foreground/90">
                "{r.text}"
              </blockquote>
              <figcaption className="mt-4 border-t border-border/60 pt-3 font-mono2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {r.displayName}
                {r.verified === 1 && <span className="ml-2 text-pos">· verified customer</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="panel rounded-sm px-6 py-10 text-center">
          <p className="text-sm font-bold">No reviews yet — be the first.</p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
            We only publish genuine customer feedback, exactly as submitted.
            Every review is moderated before it appears here — nothing is
            invented, edited, or padded with examples.
          </p>
        </div>
      )}

      <ReviewForm />
    </section>
  );
}
