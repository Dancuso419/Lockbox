import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

type Theme = "dark" | "light";
type Origin = { x: number; y: number };
type Ctx = {
  theme: Theme;
  /** Swap themes, revealing the new one in a circle from `origin` if given. */
  toggle: (origin?: Origin) => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<Ctx | null>(null);

function initialTheme(): Theme {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // ponytail: private-mode localStorage failure is non-fatal
    }
  }, [theme]);

  // Applied straight to the document as well as to state: inside a view
  // transition the DOM has to be updated synchronously, before the browser
  // takes its "after" snapshot.
  function commit(t: Theme) {
    setThemeState(t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }

  const setTheme = (t: Theme) => commit(t);

  function toggle(origin?: Origin) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // No View Transitions (Firefox/Safari<18) or motion turned down: plain swap.
    if (reduced || !document.startViewTransition) {
      commit(next);
      return;
    }

    // The new theme is revealed by a circle growing from wherever the switch
    // was hit, so the change reads as one gesture rather than a global flash.
    const root = document.documentElement;
    const x = origin?.x ?? window.innerWidth - 80;
    const y = origin?.y ?? 40;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );
    root.style.setProperty("--vt-x", `${x}px`);
    root.style.setProperty("--vt-y", `${y}px`);
    root.style.setProperty("--vt-r", `${radius}px`);

    document.startViewTransition(() => flushSync(() => commit(next)));
  }

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
