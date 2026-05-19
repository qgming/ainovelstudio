import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Theme as TauriTheme } from "@tauri-apps/api/window";
import { create } from "zustand";
import { touchClientStateUpdatedAt } from "@features/settings/data-sync/clientState";
import { isMobileRuntime } from "@shared/platform";

export const THEME_STORAGE_KEY = "ainovelstudio-theme";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

type ThemeState = {
  initialized: boolean;
  theme: ThemeMode;
  themePreference: ThemePreference;
  initializeTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  setThemePreference: (themePreference: ThemePreference) => void;
  toggleTheme: () => void;
};

let cleanupSystemThemeListener: (() => void) | null = null;

function canUseWindow() {
  return typeof window !== "undefined";
}

function getStoredThemePreference(): ThemePreference | null {
  if (!canUseWindow()) {
    return null;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
    ? storedTheme
    : null;
}

function getMatchMedia() {
  if (!canUseWindow() || typeof window.matchMedia !== "function") {
    return null;
  }

  return window.matchMedia("(prefers-color-scheme: dark)");
}

function getBrowserSystemTheme(): ThemeMode {
  return getMatchMedia()?.matches ? "dark" : "light";
}

async function getSystemTheme(): Promise<ThemeMode> {
  if (isMobileRuntime()) {
    return getBrowserSystemTheme();
  }

  if (isTauri()) {
    try {
      const appWindow = getCurrentWindow();
      if (typeof appWindow.theme !== "function") {
        return getBrowserSystemTheme();
      }

      const tauriTheme = await appWindow.theme();
      if (tauriTheme === "light" || tauriTheme === "dark") {
        return tauriTheme;
      }
    } catch {
      // Fall back to the WebView media query when the native theme is unavailable.
    }
  }

  return getBrowserSystemTheme();
}

function resolveTheme(themePreference: ThemePreference, systemTheme: ThemeMode): ThemeMode {
  return themePreference === "system" ? systemTheme : themePreference;
}

function applyTheme(theme: ThemeMode) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }
}

function persistThemePreference(themePreference: ThemePreference) {
  if (!canUseWindow()) {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
}

async function syncPlatformTheme(themePreference: ThemePreference, resolvedTheme: ThemeMode) {
  if (!isTauri() || isMobileRuntime()) {
    return;
  }

  try {
    const appWindow = getCurrentWindow();
    if (typeof appWindow.setTheme !== "function") {
      return;
    }

    const nextTheme: TauriTheme | null = themePreference === "system" ? null : resolvedTheme;
    await appWindow.setTheme(nextTheme);
  } catch {
    // Android does not support native setTheme; the WebView theme still applies.
  }
}

function detachSystemThemeListener() {
  cleanupSystemThemeListener?.();
  cleanupSystemThemeListener = null;
}

function attachSystemThemeListener(onSystemThemeChange: (theme: ThemeMode) => void) {
  detachSystemThemeListener();

  const mediaQuery = getMatchMedia();
  let removeMediaListener: (() => void) | null = null;
  let removeForegroundListener: (() => void) | null = null;

  const syncBrowserSystemTheme = () => {
    onSystemThemeChange(getBrowserSystemTheme());
  };

  if (mediaQuery) {
    const handleChange = (event: MediaQueryListEvent) => {
      onSystemThemeChange(event.matches ? "dark" : "light");
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      removeMediaListener = () => mediaQuery.removeEventListener("change", handleChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      removeMediaListener = () => mediaQuery.removeListener(handleChange);
    }
  }

  if (canUseWindow()) {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncBrowserSystemTheme();
      }
    };

    window.addEventListener("focus", syncBrowserSystemTheme);
    window.addEventListener("pageshow", syncBrowserSystemTheme);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    removeForegroundListener = () => {
      window.removeEventListener("focus", syncBrowserSystemTheme);
      window.removeEventListener("pageshow", syncBrowserSystemTheme);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }

  let disposed = false;
  let unlistenWindowTheme: (() => void) | null = null;

  if (isTauri() && !isMobileRuntime()) {
    const appWindow = getCurrentWindow();
    if (typeof appWindow.onThemeChanged === "function") {
      void appWindow.onThemeChanged(({ payload }) => {
        if (payload === "light" || payload === "dark") {
          onSystemThemeChange(payload);
        }
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenWindowTheme = unlisten;
      }).catch(() => undefined);
    }
  }

  cleanupSystemThemeListener = () => {
    disposed = true;
    removeMediaListener?.();
    removeForegroundListener?.();
    unlistenWindowTheme?.();
  };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  initialized: false,
  theme: "light",
  themePreference: "system",
  initializeTheme: () => {
    const themePreference = getStoredThemePreference() ?? "system";

    attachSystemThemeListener((systemTheme) => {
      const state = get();
      if (state.themePreference !== "system") {
        return;
      }

      const nextTheme = resolveTheme("system", systemTheme);
      applyTheme(nextTheme);
      set({ theme: nextTheme, initialized: true });
    });

    void getSystemTheme().then((systemTheme) => {
      const nextTheme = resolveTheme(themePreference, systemTheme);
      applyTheme(nextTheme);
      void syncPlatformTheme(themePreference, nextTheme);
      set({
        theme: nextTheme,
        themePreference,
        initialized: true,
      });
    });
  },
  setTheme: (theme) => {
    const themePreference: ThemePreference = theme;
    applyTheme(theme);
    persistThemePreference(themePreference);
    touchClientStateUpdatedAt();
    void syncPlatformTheme(themePreference, theme);
    set({ theme, themePreference, initialized: true });
  },
  setThemePreference: (themePreference) => {
    persistThemePreference(themePreference);
    touchClientStateUpdatedAt();

    if (themePreference === "system") {
      void getSystemTheme().then((systemTheme) => {
        const nextTheme = resolveTheme("system", systemTheme);
        applyTheme(nextTheme);
        void syncPlatformTheme("system", nextTheme);
        set({ theme: nextTheme, themePreference: "system", initialized: true });
      });
      return;
    }

    applyTheme(themePreference);
    void syncPlatformTheme(themePreference, themePreference);
    set({ theme: themePreference, themePreference, initialized: true });
  },
  toggleTheme: () => {
    const state = get();
    const currentTheme = state.initialized ? state.theme : getBrowserSystemTheme();
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    get().setTheme(nextTheme);
  },
}));
