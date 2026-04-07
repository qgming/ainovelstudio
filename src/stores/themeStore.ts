import { create } from "zustand";

export const THEME_STORAGE_KEY = "ainovelstudio-theme";

export type ThemeMode = "light" | "dark";

type ThemeState = {
  initialized: boolean;
  theme: ThemeMode;
  initializeTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
};

function getStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
}

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: ThemeMode) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function resolveTheme(): ThemeMode {
  return getStoredTheme() ?? getSystemTheme();
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  initialized: false,
  theme: "light",
  initializeTheme: () => {
    const theme = resolveTheme();
    applyTheme(theme);
    set({ theme, initialized: true });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme, initialized: true });
  },
  toggleTheme: () => {
    const currentTheme = get().initialized ? get().theme : resolveTheme();
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    set({ theme: nextTheme, initialized: true });
  },
}));
