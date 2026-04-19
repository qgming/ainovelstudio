import { Blocks, ChevronRight, History, SquarePen } from "lucide-react";
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
import { AgentComposer } from "../agent/AgentComposer";
import { AgentContextOverview } from "../agent/AgentContextOverview";
import { AgentMessageList } from "../agent/AgentMessageList";
import { selectIsAgentRunActive, useAgentStore } from "../../stores/agentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { getEnabledAgents, useSubAgentStore } from "../../stores/subAgentStore";
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

function AgentHeaderButton() {
  return (
    <div className="flex min-w-0 items-center gap-1 px-1">
      <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
      <PanelTitle>Agent</PanelTitle>
    </div>
  );
}

export function BookAgentPanel({ width }: BookAgentPanelProps) {
  const activeFilePath = useBookWorkspaceStore((state) => state.activeFilePath);
  const rootNode = useBookWorkspaceStore((state) => state.rootNode);
  const rootBookId = useBookWorkspaceStore((state) => state.rootBookId);
  const activeSessionId = useAgentStore((state) => state.activeSessionId);
  const createNewSession = useAgentStore((state) => state.createNewSession);
  const errorMessage = useAgentStore((state) => state.errorMessage);
  const input = useAgentStore((state) => state.input);
  const isHistoryOpen = useAgentStore((state) => state.isHistoryOpen);
  const openHistory = useAgentStore((state) => state.openHistory);
  const planningState = useAgentStore((state) => state.planningState);
  const closeHistory = useAgentStore((state) => state.closeHistory);
  const run = useAgentStore((state) => state.run);
  const isRunning = useAgentStore(selectIsAgentRunActive);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const sessions = useAgentStore((state) => state.sessions);
  const setInput = useAgentStore((state) => state.setInput);
  const stopMessage = useAgentStore((state) => state.stopMessage);
  const switchSession = useAgentStore((state) => state.switchSession);
  const initializeAgentHistory = useAgentStore((state) => state.initialize);
  const rootPath = useBookWorkspaceStore((state) => state.rootPath);
  const initializeSkills = useSkillsStore((state) => state.initialize);
  const manifests = useSkillsStore((state) => state.manifests);
  const preferences = useSkillsStore((state) => state.preferences);
  const skillsStatus = useSkillsStore((state) => state.status);
  const initializeAgents = useSubAgentStore((state) => state.initialize);
  const enabledSkills = getEnabledSkills({ manifests, preferences });
  const agentManifests = useSubAgentStore((state) => state.manifests);
  const agentPreferences = useSubAgentStore((state) => state.preferences);
  const agentsStatus = useSubAgentStore((state) => state.status);
  const enabledAgents = getEnabledAgents({ manifests: agentManifests, preferences: agentPreferences });
  const displayRunStatus = isRunning ? "running" : run.status;

  useEffect(() => {
    if (skillsStatus === "idle") {
      void initializeSkills();
    }
    if (agentsStatus === "idle") {
      void initializeAgents();
    }
  }, [agentsStatus, initializeAgents, initializeSkills, skillsStatus]);

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
        <AgentHeaderButton />
        <PanelToolbar className="gap-0.5">
          {/* 工作区上下文：使用 DropdownMenu 承载块状内容（非菜单项） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolbarButton ariaLabel="打开工作区上下文">
                <Blocks className="h-4 w-4" />
              </ToolbarButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-2">
              <AgentContextOverview
                activeFilePath={activeFilePath}
                enabledAgents={enabledAgents.map((agent) => ({
                  description: agent.role || agent.description,
                  id: agent.id,
                  name: agent.name,
                }))}
                enabledSkills={enabledSkills.map((skill) => ({
                  description: skill.description,
                  id: skill.id,
                  name: skill.name,
                }))}
                rootPath={rootPath}
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
      <AgentMessageList messages={run.messages} runStatus={displayRunStatus} />
      <AgentComposer
        input={input}
        onInputChange={setInput}
        onStop={stopMessage}
        planningState={planningState}
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
          ...enabledAgents.map((agent) => ({
            description: agent.role || agent.description,
            id: agent.id,
            kind: "agent" as const,
            name: agent.name,
          })),
        ]}
        rootNode={rootNode}
        runStatus={displayRunStatus}
      />
    </aside>
  );
}
