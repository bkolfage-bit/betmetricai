import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";

/**
 * Heart-shaped save/unsave button shown on every pick card (far right).
 * Signed-out users are sent to the login page on tap. Saves the pick —
 * not a specific version — so it follows the pick as the market moves.
 */
export function SaveButton({ pickId }: { pickId: number }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: ids } = trpc.saved.ids.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  const saved = !!ids?.includes(pickId);
  const [pending, setPending] = useState(false);

  const invalidate = () => {
    utils.saved.ids.invalidate();
    utils.saved.list.invalidate();
  };
  const add = trpc.saved.add.useMutation({ onSuccess: invalidate, onSettled: () => setPending(false) });
  const remove = trpc.saved.remove.useMutation({ onSuccess: invalidate, onSettled: () => setPending(false) });

  return (
    <button
      type="button"
      aria-label={saved ? "Remove from saved picks" : "Save this pick"}
      title={saved ? "Saved — tap to remove" : user ? "Save to your list" : "Sign in to save picks"}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation(); // never toggle the card's expand/collapse
        e.preventDefault();
        if (!user) {
          window.location.href = "/login";
          return;
        }
        setPending(true);
        if (saved) remove.mutate({ pickId });
        else add.mutate({ pickId });
      }}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all",
        saved
          ? "border-[#f472b6]/60 bg-[#f472b6]/15 text-[#f472b6] shadow-[0_0_14px_rgba(244,114,182,0.35)]"
          : "border-border text-muted-foreground hover:border-[#f472b6]/60 hover:text-[#f472b6]",
        pending && "opacity-50",
      )}
    >
      <Heart className={cn("h-5 w-5 transition-transform active:scale-125", saved && "fill-[#f472b6]")} />
    </button>
  );
}
