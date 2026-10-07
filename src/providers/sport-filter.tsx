import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Global sport visibility — "sort out unwanted sports".
 *
 * One shared filter across the whole terminal: hidden sports are removed
 * from picks, +EV, live, props, parlays, line movement, performance,
 * the ticker and the bet tracker. Persisted in localStorage so the
 * preference survives reloads.
 */
const STORAGE_KEY = "betmetric.hiddenSports.v1";

interface SportFilterCtx {
  /** sport codes the user has hidden */
  hidden: string[];
  /** true when nothing is hidden */
  allVisible: boolean;
  isVisible: (code: string) => boolean;
  toggle: (code: string) => void;
  showAll: () => void;
  /** returns visible codes given the full universe */
  visibleCodes: (all: string[]) => string[];
}

const Ctx = createContext<SportFilterCtx | null>(null);

function loadHidden(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function SportFilterProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<string[]>(loadHidden);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
    } catch {
      /* storage unavailable — filter still works for the session */
    }
  }, [hidden]);

  const value = useMemo<SportFilterCtx>(
    () => ({
      hidden,
      allVisible: hidden.length === 0,
      isVisible: (code) => !hidden.includes(code),
      toggle: (code) =>
        setHidden((h) => (h.includes(code) ? h.filter((c) => c !== code) : [...h, code])),
      showAll: () => setHidden([]),
      visibleCodes: (all) => all.filter((c) => !hidden.includes(c)),
    }),
    [hidden],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSportFilter(): SportFilterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSportFilter must be used inside SportFilterProvider");
  return ctx;
}
