import { ChevronRight, Gauge, History, SquarePen } from "lucide-react";
import { forwardRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PanelHeader, PanelNotice, PanelTitle, PanelToolbar } from "@/components/ui/panel";
import { AgentComposer, DEFAULT_AGENT_COMPOSER_MODES } from "../agent/AgentComposer";
import { AgentContextOverview } from "../agent/AgentContextOverview";
import { AgentInfoDisplay } from "../agent/AgentInfoDisplay";
import { AgentMessageList } from "../agent/AgentMessageList";
import { selectIsAgentRunActive } from "../../stores/chatRun/helpers";
import { useChatRunStore } from "../../stores/chatRunStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";

type BookAgentPanelProps = {
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
      <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
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

export function BookAgentPanel({ width }: BookAgentPanelProps) {
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
  const errorMessage = useChatRunStore((state) => state.errorMessage);
  const followUpMessage = useChatRunStore((state) => state.followUpMessage);
  const input = useChatRunStore((state) => state.input);
  const isCompacting = useChatRunStore((state) => state.isCompacting);
  const isHistoryOpen = useChatRunStore((state) => state.isHistoryOpen);
  const latestCompactionAt = useChatRunStore((state) => state.latestCompactionAt);
  const latestCompactionTokensBefore = useChatRunStore((state) => state.latestCompactionTokensBefore);
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
  const stopMessage = useChatRunStore((state) => state.stopMessage);
  const submitAskAnswer = useChatRunStore((state) => state.submitAskAnswer);
  const switchSession = useChatRunStore((state) => state.switchSession);
  const initializeAgentHistory = useChatRunStore((state) => state.initialize);
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

  return (
    <aside
      style={width ? { width } : undefined}
      className="flex h-full shrink-0 flex-col overflow-hidden bg-app"
    >
      <PanelHeader className="bg-transparent px-2">
        <AgentHeaderButton modeLabel={activeModeLabel} />
        <PanelToolbar className="gap-0.5">
          {/* 会话上下文：使用 DropdownMenu 承载块状内容（非菜单项） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolbarButton ariaLabel="打开会话上下文">
                <Gauge className="h-4 w-4" />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[24rem] p-2">
              <AgentContextOverview
                compactionCount={compactionCount}
                currentModel={currentModel}
                isCompacting={isCompacting}
                latestCompactionAt={latestCompactionAt}
                latestCompactionTokensBefore={latestCompactionTokensBefore}
                messages={run.messages}
                onCompact={() => void compactSession("manual")}
                sessionCreatedAt={activeSessionSummary?.createdAt ?? null}
                sessionTitle={run.title}
                sessionUpdatedAt={activeSessionSummary?.updatedAt ?? null}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 历史会话：使用 DropdownMenu + DropdownMenuItem */}
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
                    <DropdownMenuItem
                      key={session.id}
                      disabled={isRunning}
                      onSelect={() => handleSessionSelect(session.id)}
                      className={isActive ? "bg-accent text-accent-foreground" : undefined}
                    >
                      <span className="min-w-0 truncate">{session.title}</span>
                    </DropdownMenuItem>
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
        <PanelNotice tone="error" className="text-xs">
          {errorMessage}
        </PanelNotice>
      ) : null}
      {activeModeId === "autopilot" && autopilotGoal ? (
        <AgentInfoDisplay
          description={autopilotGoal}
          title="当前目标"
        />
      ) : null}
      <AgentMessageList messages={run.messages} runStatus={displayRunStatus} />
      <AgentComposer
        activeModeId={activeModeId}
        input={input}
        onCoach={coachMessage}
        onInputChange={setInput}
        onModeChange={setActiveMode}
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
      />
    </aside>
  );
}
