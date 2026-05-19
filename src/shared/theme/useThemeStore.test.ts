import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeStore } from "./useThemeStore";

const { mockIsMobileRuntime, mockTauriWindow } = vi.hoisted(() => ({
  mockIsMobileRuntime: vi.fn(() => false),
  mockTauriWindow: {
    onThemeChanged: vi.fn().mockResolvedValue(() => {}),
    setTheme: vi.fn().mockResolvedValue(undefined),
    theme: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@shared/platform", () => ({
  isMobileRuntime: mockIsMobileRuntime,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mockTauriWindow,
}));

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
    mockIsMobileRuntime.mockReset();
    mockIsMobileRuntime.mockReturnValue(false);
    mockTauriWindow.onThemeChanged.mockReset();
    mockTauriWindow.onThemeChanged.mockResolvedValue(() => {});
    mockTauriWindow.setTheme.mockReset();
    mockTauriWindow.setTheme.mockResolvedValue(undefined);
    mockTauriWindow.theme.mockReset();
    mockTauriWindow.theme.mockResolvedValue(null);
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

  it("Android 跟随系统时优先使用 WebView 的 prefers-color-scheme", async () => {
    mockIsMobileRuntime.mockReturnValue(true);
    mockTauriWindow.theme.mockResolvedValue("light");
    installMatchMedia(true);

    useThemeStore.getState().initializeTheme();

    await vi.waitFor(() => {
      expect(useThemeStore.getState().theme).toBe("dark");
      expect(useThemeStore.getState().themePreference).toBe("system");
      expect(document.documentElement).toHaveClass("dark");
    });
    expect(mockTauriWindow.theme).not.toHaveBeenCalled();
    expect(mockTauriWindow.onThemeChanged).not.toHaveBeenCalled();
  });

  it("跟随系统模式会在页面重新可见时重读系统主题", async () => {
    const media = installMatchMedia(false);

    useThemeStore.getState().initializeTheme();
    await vi.waitFor(() => {
      expect(useThemeStore.getState().theme).toBe("light");
    });

    media.setMatches(true);
    expect(useThemeStore.getState().theme).toBe("dark");

    media.setMatches(false);
    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => {
      expect(useThemeStore.getState().theme).toBe("light");
      expect(document.documentElement).not.toHaveClass("dark");
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
