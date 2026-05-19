import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeStore } from "./useThemeStore";

type MatchMediaMock = {
  setMatches: (next: boolean) => void;
};

function installMatchMedia(initialDark = false): MatchMediaMock {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: vi.fn(),
    })),
  });

  return {
    setMatches(next) {
      matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe("useThemeStore", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "light";
    window.localStorage.clear();
    useThemeStore.setState({
      initialized: false,
      theme: "light",
      themePreference: "system",
    });
  });

  it("跟随系统模式会响应系统主题变化", async () => {
    const media = installMatchMedia(false);

    useThemeStore.getState().initializeTheme();
    await vi.waitFor(() => {
      expect(useThemeStore.getState().theme).toBe("light");
      expect(useThemeStore.getState().themePreference).toBe("system");
    });

    media.setMatches(true);

    await vi.waitFor(() => {
      expect(useThemeStore.getState().theme).toBe("dark");
      expect(document.documentElement).toHaveClass("dark");
    });
  });

  it("手动主题不会被系统主题变化覆盖", async () => {
    const media = installMatchMedia(false);

    useThemeStore.getState().initializeTheme();
    await vi.waitFor(() => {
      expect(useThemeStore.getState().theme).toBe("light");
    });

    useThemeStore.getState().setThemePreference("dark");
    expect(useThemeStore.getState().theme).toBe("dark");

    media.setMatches(false);
    media.setMatches(true);

    await vi.waitFor(() => {
      expect(useThemeStore.getState().themePreference).toBe("dark");
      expect(useThemeStore.getState().theme).toBe("dark");
      expect(document.documentElement).toHaveClass("dark");
    });
  });
});
