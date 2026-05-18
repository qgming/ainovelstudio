import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MobileNavigation } from "@app/components/MobileNavigation";
import { TitleBar } from "@app/components/TitleBar";
import { Toaster } from "@shared/ui/sonner";
import { TooltipProvider } from "@shared/ui/tooltip";
import { useIsMobile } from "@shared/hooks/useMobile";
import { isMobileRuntime } from "@shared/platform";
import { BookLibraryPage } from "@features/books/pages/BookLibraryPage";
import { selectIsAgentRunActive, useChatRunStore } from "@features/agent/stores/useChatRunStore";
import type { ChatRunStore } from "@features/agent/stores/useChatRunStore";
import { useThemeStore } from "@shared/theme/useThemeStore";
import { useUpdateStore } from "@features/update/stores/useUpdateStore";
import { UpdateReleaseDialog } from "@features/update/components/UpdateReleaseDialog";
import { normalizeVersionLabel } from "@features/update/lib/version";

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
const LeaderboardPage = lazy(() =>
  import("@features/leaderboard/LeaderboardPage").then((module) => ({ default: module.LeaderboardPage })),
);
const LeaderboardStatsPage = lazy(() =>
  import("@features/leaderboard/LeaderboardStatsPage").then((module) => ({ default: module.LeaderboardStatsPage })),
);
function AppRouteLoadingState() {
  return (
    <section className="editor-shell flex h-full min-h-0 items-center justify-center px-6 text-sm text-muted-foreground">
      正在启动工作区...
    </section>
  );
}

function getTrayAgentStatusLabel(state: ChatRunStore) {
  if (state.status === "loading") return "初始化中";
  if (state.status === "error") return "状态异常";
  if (state.pendingAsk || state.run.status === "awaiting_user") return "等待用户";
  if (state.inflightToolRequestIds.length > 0) return "工具读写中";
  if (selectIsAgentRunActive(state)) return "AI 运行中";
  if (state.run.status === "failed") return "上次失败";
  if (state.run.status === "completed") return "已完成";
  return "空闲";
}

function AppShell() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const downloadAvailableUpdate = useUpdateStore((state) => state.downloadAvailableUpdate);
  const runStartupUpdateFlow = useUpdateStore((state) => state.runStartupUpdateFlow);
  const updateStatus = useUpdateStore((state) => state.status);
  const updateSummary = useUpdateStore((state) => state.updateSummary);
  const location = useLocation();
  const isMobileViewport = useIsMobile();
  const mobileRuntime = isMobileRuntime();
  const showMobileNavigation = mobileRuntime || isMobileViewport;
  const [homeUpdateDialogOpen, setHomeUpdateDialogOpen] = useState(false);
  const [manualUpdateDialogOpen, setManualUpdateDialogOpen] = useState(false);
  const shownHomeUpdateVersionRef = useRef<string | null>(null);
  const hasAvailableUpdate = updateStatus === "available" && updateSummary;
  const updateDialogOpen = homeUpdateDialogOpen || manualUpdateDialogOpen;

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  useEffect(() => {
    void runStartupUpdateFlow();
  }, [runStartupUpdateFlow]);

  useEffect(() => {
    if (location.pathname !== "/" || updateStatus !== "available" || !updateSummary) {
      return;
    }
    if (shownHomeUpdateVersionRef.current === updateSummary.version) {
      return;
    }
    shownHomeUpdateVersionRef.current = updateSummary.version;
    setHomeUpdateDialogOpen(true);
  }, [location.pathname, updateStatus, updateSummary]);

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

  useEffect(() => {
    if (mobileRuntime) {
      return;
    }

    let lastStatusLabel = "";
    function syncTrayStatus(state = useChatRunStore.getState()) {
      const statusLabel = getTrayAgentStatusLabel(state);
      if (statusLabel === lastStatusLabel) {
        return;
      }
      lastStatusLabel = statusLabel;
      void invoke("update_tray_ai_status", { statusLabel }).catch(() => undefined);
    }

    syncTrayStatus();
    return useChatRunStore.subscribe(syncTrayStatus);
  }, [mobileRuntime]);

  return (
    <div className="editor-shell h-dvh min-h-dvh overflow-hidden transition-colors duration-150">
      <div
        className={`flex h-full flex-col overflow-hidden ${mobileRuntime ? "pt-[env(safe-area-inset-top)]" : ""}`}
      >
        {mobileRuntime ? null : <TitleBar />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-hidden bg-app">
            <Suspense fallback={<AppRouteLoadingState />}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <BookLibraryPage
                      updateAction={
                        hasAvailableUpdate
                          ? {
                              label: `查看 ${normalizeVersionLabel(updateSummary.version)} 更新`,
                              text: `更新 ${normalizeVersionLabel(updateSummary.version)}`,
                              onClick: () => setManualUpdateDialogOpen(true),
                            }
                          : undefined
                      }
                    />
                  }
                />
                <Route path="/book" element={<Navigate to="/" replace />} />
                <Route path="/books/workspace" element={<Navigate to="/" replace />} />
                <Route path="/books/:bookId" element={<BookWorkspaceRoute />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/skills/:skillId" element={<SkillDetailPage />} />
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                <Route path="/leaderboard/statistics" element={<LeaderboardStatsPage />} />
                <Route path="/setting" element={<SettingPage />} />
                <Route path="/setting/:sectionKey" element={<SettingPage />} />
              </Routes>
            </Suspense>
          </main>
          {showMobileNavigation ? <MobileNavigation /> : null}
        </div>
      </div>
      <UpdateReleaseDialog
        open={updateDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setManualUpdateDialogOpen(true);
            return;
          }
          setHomeUpdateDialogOpen(false);
          setManualUpdateDialogOpen(false);
        }}
        onDownload={() => {
          void downloadAvailableUpdate();
        }}
        summary={updateSummary}
      />
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
