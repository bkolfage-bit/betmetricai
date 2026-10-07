import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Global sport focus — view just one sport across the whole terminal.
 *
 * `sport = null` means ALL sports. Picking a sport narrows picks, +EV,
 * live, props, parlays, line movement, performance, the ticker and the
 * bet tracker to that sport only. Persisted in localStorage.
 */
const STORAGE_KEY = "betmetric.sportFocus.v1";

interface SportFilterCtx {
  /** focused sport code, or null for ALL */
  sport: string | null;
  setSport: (code: string | null) => void;
  /** true when the row's sport should be shown */
  isVisible: (code: string) => boolean;
}

const Ctx = createContext<SportFilterCtx | null>(null);

function load(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw !== "ALL" ? raw : null;
  } catch {
    return null;
  }
}

export function SportFilterProvider({ children }: { children: ReactNode }) {
  const [sport, setSportState] = useState<string | null>(load);

  const setSport = (code: string | null) => {
    setSportState(code);
    try {
      if (code) localStorage.setItem(STORAGE_KEY, code);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — focus still works for the session */
    }
  };

  const value = useMemo<SportFilterCtx>(
    () => ({
      sport,
      setSport,
      isVisible: (code) => sport === null || code === sport,
    }),
    [sport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSportFilter(): SportFilterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSportFilter must be used inside SportFilterProvider");
  return ctx;
}
