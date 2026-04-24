import { lazy, Suspense, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { isMobileRuntime } from "./lib/platform";
import { HomePage } from "./pages/HomePage";
import { useThemeStore } from "./stores/themeStore";
import { useUpdateStore } from "./stores/updateStore";

const AgentDetailPage = lazy(() =>
  import("./pages/AgentDetailPage").then((module) => ({ default: module.AgentDetailPage })),
);
const AgentsPage = lazy(() =>
  import("./pages/AgentsPage").then((module) => ({ default: module.AgentsPage })),
);
const BookWorkspacePage = lazy(() =>
  import("./pages/BookWorkspacePage").then((module) => ({ default: module.BookWorkspacePage })),
);
const ExpansionsPage = lazy(() =>
  import("./pages/ExpansionsPage").then((module) => ({ default: module.ExpansionsPage })),
);
const ExpansionDetailPage = lazy(() =>
  import("./pages/ExpansionDetailPage").then((module) => ({ default: module.ExpansionDetailPage })),
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
const WorkflowDetailPage = lazy(() =>
  import("./pages/WorkflowDetailPage").then((module) => ({ default: module.WorkflowDetailPage })),
);
const WorkflowsPage = lazy(() =>
  import("./pages/WorkflowsPage").then((module) => ({ default: module.WorkflowsPage })),
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
                <Route path="/" element={<HomePage />} />
                <Route path="/book" element={<Navigate to="/" replace />} />
                <Route path="/books/workspace" element={<Navigate to="/" replace />} />
                <Route path="/books/:bookId" element={<BookWorkspacePage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/skills/:skillId" element={<SkillDetailPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/:agentId" element={<AgentDetailPage />} />
                <Route path="/workflows" element={<WorkflowsPage />} />
                <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
                <Route path="/expansions" element={<ExpansionsPage />} />
                <Route path="/expansions/:workspaceId" element={<ExpansionDetailPage />} />
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
