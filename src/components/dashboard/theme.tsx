"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { THEME_COOKIE, type ResolvedTheme, type ThemePreference } from "@/lib/theme";

/**
 * Class-based theme handling with a persisted preference ("intervia-theme" in
 * localStorage: light | dark | system).
 *
 * The root layout reads the resolved theme from a cookie and puts the class on
 * <html> in the HTML it sends, so the first paint is already correct without a
 * blocking script. This provider takes over after hydration: it migrates an
 * older localStorage-only preference, follows the system preference while
 * "system" is selected, and keeps the cookie in step.
 */

export type { ThemePreference };

const STORAGE_KEY = "intervia-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface ThemeContextValue {
  preference: ThemePreference;
  /** The theme actually rendered (system preference resolved). */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Private mode etc. — fall back to light.
  }
  return "light";
}

function subscribeToSystem(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const systemDark = useSyncExternalStore(
    subscribeToSystem,
    systemPrefersDark,
    () => false, // No system preference on the server; the cookie decided there.
  );

  const resolved: ResolvedTheme =
    preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";

  // Reflect the resolved theme on <html> and in the cookie the server reads on
  // the next request. Touches only the DOM and the cookie — no React state.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    try {
      document.cookie = `${THEME_COOKIE}=${resolved}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      // Cookies blocked: the class still applies for this page view.
    }
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
