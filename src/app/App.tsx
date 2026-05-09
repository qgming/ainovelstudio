import { lazy, Suspense, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "@app/components/Sidebar";
import { TitleBar } from "@app/components/TitleBar";
import { Toaster } from "@shared/ui/sonner";
import { TooltipProvider } from "@shared/ui/tooltip";
import { isMobileRuntime } from "@shared/platform";
import { BookLibraryPage } from "@features/books/pages/BookLibraryPage";
import { useThemeStore } from "@shared/theme/useThemeStore";
import { useUpdateStore } from "@features/update/stores/useUpdateStore";

const BookWorkspaceRoute = lazy(() =>
  import("@features/books/pages/BookWorkspaceRoute").then((module) => ({ default: module.BookWorkspaceRoute })),
);
const SettingPage = lazy(() =>
  import("@features/settings/pages/SettingPage").then((module) => ({ default: module.SettingPage })),
);
const SkillDetailPage = lazy(() =>
  import("@features/skills/pages/SkillDetailPage").then((module) => ({ default: module.SkillDetailPage })),
);
const SkillsPage = lazy(() =>
  import("@features/skills/pages/SkillsPage").then((module) => ({ default: module.SkillsPage })),
);
function AppRouteLoadingState() {
  return (
    <section className="editor-shell flex h-full min-h-0 items-center justify-center px-6 text-sm text-muted-foreground">
      正在启动工作区...
    </section>
  );
}

function AppShell() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const runStartupUpdateFlow = useUpdateStore((state) => state.runStartupUpdateFlow);
  const mobileRuntime = isMobileRuntime();

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  useEffect(() => {
    void runStartupUpdateFlow();
  }, [runStartupUpdateFlow]);

  useEffect(() => {
    if (mobileRuntime) {
      return;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await appWindow.hide();
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mobileRuntime]);

  return (
    <div className="editor-shell h-dvh min-h-dvh overflow-hidden transition-colors duration-150">
      <div
        className={`flex h-full flex-col overflow-hidden ${mobileRuntime ? "pt-[env(safe-area-inset-top)]" : ""}`}
      >
        {mobileRuntime ? null : <TitleBar />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <Sidebar />
          <main className="order-first min-h-0 flex-1 overflow-hidden bg-app md:order-none">
            <Suspense fallback={<AppRouteLoadingState />}>
              <Routes>
                <Route path="/" element={<BookLibraryPage />} />
                <Route path="/book" element={<Navigate to="/" replace />} />
                <Route path="/books/workspace" element={<Navigate to="/" replace />} />
                <Route path="/books/:bookId" element={<BookWorkspaceRoute />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/skills/:skillId" element={<SkillDetailPage />} />
                <Route path="/setting" element={<SettingPage />} />
                <Route path="/setting/:sectionKey" element={<SettingPage />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <TooltipProvider>
        <AppShell />
        <Toaster />
      </TooltipProvider>
    </HashRouter>
  );
}

export default App;
