import { lazy, Suspense, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { isMobileRuntime } from "./lib/platform";
import { HomePage } from "./pages/HomePage";
import { useThemeStore } from "./stores/themeStore";

const AgentDetailPage = lazy(() =>
  import("./pages/AgentDetailPage").then((module) => ({ default: module.AgentDetailPage })),
);
const AgentsPage = lazy(() =>
  import("./pages/AgentsPage").then((module) => ({ default: module.AgentsPage })),
);
const BookWorkspacePage = lazy(() =>
  import("./pages/BookWorkspacePage").then((module) => ({ default: module.BookWorkspacePage })),
);
const SettingPage = lazy(() =>
  import("./pages/SettingPage").then((module) => ({ default: module.SettingPage })),
);
const SkillDetailPage = lazy(() =>
  import("./pages/SkillDetailPage").then((module) => ({ default: module.SkillDetailPage })),
);
const SkillsPage = lazy(() =>
  import("./pages/SkillsPage").then((module) => ({ default: module.SkillsPage })),
);

function AppRouteLoadingState() {
  return (
    <section className="flex h-full min-h-0 items-center justify-center bg-[#f7f8fb] px-6 text-sm text-[#64748b] dark:bg-[#0f1012] dark:text-zinc-400">
      正在启动工作区...
    </section>
  );
}

function AppShell() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const mobileRuntime = isMobileRuntime();

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  useEffect(() => {
    if (mobileRuntime) {
      return;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await invoke("terminate_application");
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
    <div className="h-dvh min-h-dvh overflow-hidden bg-white text-[#111827] transition-colors duration-200 dark:bg-[#0a0a0b] dark:text-zinc-50">
      <div className="flex h-full flex-col overflow-hidden">
        {mobileRuntime ? null : <TitleBar />}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="min-h-0 flex-1 overflow-hidden bg-[#f7f8fb] dark:bg-[#0f1012]">
            <Suspense fallback={<AppRouteLoadingState />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/book" element={<Navigate to="/" replace />} />
                <Route path="/books/workspace" element={<Navigate to="/" replace />} />
                <Route path="/books/:bookId" element={<BookWorkspacePage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/skills/:skillId" element={<SkillDetailPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/:agentId" element={<AgentDetailPage />} />
                <Route path="/setting" element={<SettingPage />} />
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
      <AppShell />
    </HashRouter>
  );
}

export default App;
