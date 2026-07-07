import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  /** True if the user explicitly toggled the theme (vs route default). */
  isExplicit: boolean;
  /** Apply a route-level default theme - only takes effect if user hasn't explicitly chosen. */
  applyRouteDefault: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
  isExplicit: false,
  applyRouteDefault: () => {},
});

const EXPLICIT_KEY = "app-theme-explicit";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("app-theme") as Theme) || "dark";
    }
    return "dark";
  });
  const [isExplicit, setIsExplicit] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(EXPLICIT_KEY) === "true";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  const markExplicit = () => {
    setIsExplicit(true);
    try { localStorage.setItem(EXPLICIT_KEY, "true"); } catch { /* ignore */ }
  };
  const setTheme = (t: Theme) => { setThemeState(t); markExplicit(); };
  const toggleTheme = () => { setThemeState((p) => (p === "dark" ? "light" : "dark")); markExplicit(); };
  const applyRouteDefault = (t: Theme) => {
    // Respect explicit user choice across long sessions.
    if (isExplicit) return;
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isExplicit, applyRouteDefault }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
