import { Gauge, History, MoreHorizontal, SquarePen, Trash2 } from "lucide-react";
import { forwardRef, useEffect } from "react";
import { Button } from "@shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { cn } from "@shared/utils";
import { CollapsibleErrorNotice } from "@shared/components/CollapsibleErrorNotice";
import { PanelHeader, PanelTitle, PanelToolbar } from "@shared/ui/panel";
import { AgentComposer, DEFAULT_AGENT_COMPOSER_MODES } from "@features/agent/components/AgentComposer";
import { AgentContextOverview } from "@features/agent/components/AgentContextOverview";
import { AgentInfoDisplay } from "@features/agent/components/AgentInfoDisplay";
import { AgentMessageList } from "@features/agent/components/AgentMessageList";
import { deriveLatestYoloControl, type YoloControlData } from "@features/agent/lib/yoloControl";
import { getLatestCompactionEntry } from "@features/agent/chat/entries";
import { selectIsAgentRunActive } from "@features/agent/stores/chat-run/helpers";
import { useChatRunStore } from "@features/agent/stores/useChatRunStore";
import { useAgentSettingsStore } from "@features/settings/stores/useAgentSettingsStore";
import { getEnabledSkills, useSkillsStore } from "@features/skills/stores/useSkillsStore";
import { useBookWorkspaceStore } from "@features/books/stores/useBookWorkspaceStore";

type BookAgentPanelProps = {
  resizeHandle?: React.ReactNode;
  variant?: "card" | "flush";
  width?: number | string;
};

type ToolbarButtonProps = {
  ariaLabel: string;
} & React.ComponentProps<typeof Button>;

// 顶部工具栏图标按钮：在 PanelHeader 中保持极简风。
const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ ariaLabel, children, className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        title={
          ariaLabel === "打开会话上下文"
            ? "打开会话上下文 — 查看当前会话和最近一次模型调用的上下文占用"
            : ariaLabel === "打开历史记录"
              ? "打开历史记录 — 查看当前书籍下的历史会话"
              : ariaLabel === "收起历史记录"
                ? "收起历史记录 — 收起历史会话列表"
                : "开始新对话 — 新建一个独立的 Agent 会话"
        }
        variant="ghost"
        size="icon-sm"
        className={cn("text-muted-foreground", className)}
        {...props}
      >
        {children}
      </Button>
    );
  },
);

ToolbarButton.displayName = "ToolbarButton";

function AgentHeaderButton({ modeLabel }: { modeLabel: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 px-1">
      <PanelTitle>Agent</PanelTitle>
      <span
        aria-label="当前 Agent 模式"
        className="editor-status-chip ml-1 max-w-20 truncate bg-background/45"
      >
        {modeLabel}
      </span>
    </div>
  );
}

function getYoloActionLabel(action: YoloControlData["action"]) {
  if (action === "complete") return "已完成";
  if (action === "blocked") return "已阻塞";
  return "继续执行";
}

function buildYoloStatusLine(goal: string, control: YoloControlData | null) {
  if (!control) return `YOLO：${goal}`;
  const status = control.accepted ? getYoloActionLabel(control.action) : "未通过";
  return `YOLO：${status} · ${goal}`;
}

export function BookAgentPanel({ resizeHandle, variant = "flush", width }: BookAgentPanelProps) {
  const rootNode = useBookWorkspaceStore((state) => state.rootNode);
  const rootBookId = useBookWorkspaceStore((state) => state.rootBookId);
  const activeModeId = useChatRunStore((state) => state.activeModeId);
  const activeSessionId = useChatRunStore((state) => state.activeSessionId);
  const autopilotGoal = useChatRunStore((state) =>
    state.activeSessionId ? (state.autopilotGoalsBySession[state.activeSessionId] ?? null) : null,
  );
  const compactSession = useChatRunStore((state) => state.compactSession);
  const compactionCount = useChatRunStore((state) => state.compactionCount);
  const createNewSession = useChatRunStore((state) => state.createNewSession);
  const deleteSession = useChatRunStore((state) => state.deleteSession);
  const errorMessage = useChatRunStore((state) => state.errorMessage);
  const followUpMessage = useChatRunStore((state) => state.followUpMessage);
  const input = useChatRunStore((state) => state.input);
  const isCompacting = useChatRunStore((state) => state.isCompacting);
  const isHistoryOpen = useChatRunStore((state) => state.isHistoryOpen);
  const latestCompactionAt = useChatRunStore((state) => state.latestCompactionAt);
  const latestCompactionSummary = useChatRunStore((state) => {
    const sessionId = state.activeSessionId;
    if (!sessionId) return null;
    return getLatestCompactionEntry(state.entriesBySession[sessionId] ?? [])?.payload.summary ?? null;
  });
  const latestCompactionTokensBefore = useChatRunStore((state) => state.latestCompactionTokensBefore);
  const manualContextSelection = useChatRunStore((state) => state.manualContextSelection);
  const openHistory = useChatRunStore((state) => state.openHistory);
  const planningState = useChatRunStore((state) => state.planningState);
  const queuedFollowUpMessages = useChatRunStore((state) => state.queuedFollowUpMessages);
  const queuedSteeringMessages = useChatRunStore((state) => state.queuedSteeringMessages);
  const closeHistory = useChatRunStore((state) => state.closeHistory);
  const pendingAsk = useChatRunStore((state) => state.pendingAsk);
  const run = useChatRunStore((state) => state.run);
  const isRunning = useChatRunStore(selectIsAgentRunActive);
  const sendMessage = useChatRunStore((state) => state.sendMessage);
  const coachMessage = useChatRunStore((state) => state.coachMessage);
  const sessions = useChatRunStore((state) => state.sessions);
  const setActiveMode = useChatRunStore((state) => state.setActiveMode);
  const setInput = useChatRunStore((state) => state.setInput);
  const setManualContextSelection = useChatRunStore((state) => state.setManualContextSelection);
  const stopMessage = useChatRunStore((state) => state.stopMessage);
  const submitAskAnswer = useChatRunStore((state) => state.submitAskAnswer);
  const switchSession = useChatRunStore((state) => state.switchSession);
  const initializeAgentHistory = useChatRunStore((state) => state.initialize);
  const yoloControlState = deriveLatestYoloControl(run.messages);
  const initializeSkills = useSkillsStore((state) => state.initialize);
  const manifests = useSkillsStore((state) => state.manifests);
  const preferences = useSkillsStore((state) => state.preferences);
  const skillsStatus = useSkillsStore((state) => state.status);
  const enabledSkills = getEnabledSkills({ manifests, preferences });
  const currentModel = useAgentSettingsStore((state) => state.config.model);
  const activeModeLabel =
    DEFAULT_AGENT_COMPOSER_MODES.find((mode) => mode.id === activeModeId)?.label
    ?? "协作";
  const displayRunStatus = run.status === "awaiting_user"
    ? "awaiting_user"
    : isRunning
      ? "running"
      : run.status;
  const activeSessionSummary = sessions.find((session) => session.id === activeSessionId) ?? null;

  useEffect(() => {
    if (skillsStatus === "idle") {
      void initializeSkills();
    }
  }, [initializeSkills, skillsStatus]);

  useEffect(() => {
    if (!rootBookId) {
      return;
    }
    void initializeAgentHistory(rootBookId);
  }, [initializeAgentHistory, rootBookId]);

  const handleSessionSelect = (sessionId: string) => {
    closeHistory();
    void switchSession(sessionId);
  };

  const handleSessionDelete = (sessionId: string) => {
    void deleteSession(sessionId);
  };

  return (
    <aside
      style={width ? { width } : undefined}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden",
        variant === "card"
          ? "relative box-border rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none"
          : "bg-app",
      )}
    >
      <PanelHeader className="border-b-0 bg-transparent px-2">
        <AgentHeaderButton modeLabel={activeModeLabel} />
        <PanelToolbar className="gap-0.5">
          {/* 会话上下文：使用 DropdownMenu 承载块状内容（非菜单项） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolbarButton ariaLabel="打开会话上下文">
                <Gauge className="h-4 w-4" />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[25rem] max-w-[calc(100vw-1.5rem)] p-0">
              <AgentContextOverview
                compactionCount={compactionCount}
                currentModel={currentModel}
                isCompacting={isCompacting}
                latestCompactionAt={latestCompactionAt}
                latestCompactionSummary={latestCompactionSummary}
                latestCompactionTokensBefore={latestCompactionTokensBefore}
                messages={run.messages}
                onCompact={() => void compactSession("manual")}
                sessionCreatedAt={activeSessionSummary?.createdAt ?? null}
                sessionTitle={run.title}
                sessionUpdatedAt={activeSessionSummary?.updatedAt ?? null}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 历史会话：主区域切换会话，右侧更多按钮承载危险操作 */}
          <DropdownMenu
            open={isHistoryOpen}
            onOpenChange={(open) => (open ? openHistory() : closeHistory())}
          >
            <DropdownMenuTrigger asChild>
              <ToolbarButton ariaLabel={isHistoryOpen ? "收起历史记录" : "打开历史记录"}>
                <History className="h-4 w-4" />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">暂无历史会话</div>
              ) : (
                sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <div
                      key={session.id}
                      className={cn(
                        "flex items-center gap-1 rounded-md",
                        isActive ? "bg-accent text-accent-foreground" : undefined,
                      )}
                    >
                      <DropdownMenuItem
                        disabled={isRunning}
                        onSelect={() => handleSessionSelect(session.id)}
                        className="min-w-0 flex-1 bg-transparent focus:bg-accent focus:text-accent-foreground"
                      >
                        <span className="min-w-0 truncate">{session.title}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger
                          aria-label={`更多操作：${session.title}`}
                          title={`更多操作：${session.title}`}
                          className="h-7 w-7 justify-center px-0 [&>svg:last-child]:hidden"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="min-w-[9rem]">
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isRunning || isActive}
                            title={isActive ? "当前会话不能删除" : `删除会话 ${session.title}`}
                            onSelect={() => handleSessionDelete(session.id)}
                            className="gap-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            删除会话
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </div>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolbarButton ariaLabel="开始新对话" disabled={isRunning} onClick={() => void createNewSession()}>
            <SquarePen className="h-4 w-4" />
          </ToolbarButton>
        </PanelToolbar>
      </PanelHeader>
      {errorMessage ? (
        <CollapsibleErrorNotice
          className="mx-2 mb-2 text-xs"
          message={errorMessage}
        />
      ) : null}
      {activeModeId === "autopilot" && autopilotGoal ? (
        <AgentInfoDisplay
          description={buildYoloStatusLine(autopilotGoal, yoloControlState)}
          title="YOLO 状态"
        />
      ) : null}
      <AgentMessageList messages={run.messages} runStatus={displayRunStatus} />
      <AgentComposer
        activeModeId={activeModeId}
        input={input}
        onCoach={coachMessage}
        onInputChange={setInput}
        onModeChange={setActiveMode}
        onSelectionChange={setManualContextSelection}
        onFollowUp={(selection) => {
          void followUpMessage(selection);
        }}
        onStop={stopMessage}
        onSubmitAskAnswer={submitAskAnswer}
	        pendingAsk={pendingAsk}
	        planningState={planningState}
	        queuedFollowUpMessages={queuedFollowUpMessages}
	        queuedSteeringMessages={queuedSteeringMessages}
	        onSubmit={(selection) => {
          void sendMessage(selection);
        }}
        resources={[
          ...enabledSkills.map((skill) => ({
            description: skill.description,
            id: skill.id,
            kind: "skill" as const,
            name: skill.name,
          })),
        ]}
        rootNode={rootNode}
        runStatus={displayRunStatus}
        selection={manualContextSelection}
      />
      {resizeHandle}
    </aside>
  );
}
