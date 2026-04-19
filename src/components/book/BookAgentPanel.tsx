import { Blocks, ChevronRight, History, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PanelHeader, PanelNotice, PanelTitle, PanelToolbar } from "@/components/ui/panel";
import { AgentComposer } from "../agent/AgentComposer";
import { AgentContextOverview } from "../agent/AgentContextOverview";
import { AgentMessageList } from "../agent/AgentMessageList";
import { ActionMenu, ActionMenuItem, type ActionMenuAnchorRect } from "../common/ActionMenu";
import { selectIsAgentRunActive, useAgentStore } from "../../stores/agentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { getEnabledAgents, useSubAgentStore } from "../../stores/subAgentStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";

type BookAgentPanelProps = {
  width?: number | string;
};

type ToolbarButtonProps = {
  ariaLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

function ToolbarButton({ ariaLabel, children, disabled = false, onClick }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
    >
      {children}
    </Button>
  );
}

function AgentHeaderButton() {
  return (
    <div className="flex min-w-0 items-center gap-1 px-1">
      <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
      <PanelTitle>Agent</PanelTitle>
    </div>
  );
}

function toAnchorRect(rect: DOMRect): ActionMenuAnchorRect {
  return {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  };
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
  const [contextAnchorRect, setContextAnchorRect] = useState<ActionMenuAnchorRect | null>(null);
  const [historyAnchorRect, setHistoryAnchorRect] = useState<ActionMenuAnchorRect | null>(null);

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

  const isContextOpen = contextAnchorRect !== null;

  const handleContextToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isContextOpen) {
      setContextAnchorRect(null);
      return;
    }

    setHistoryAnchorRect(null);
    closeHistory();
    setContextAnchorRect(toAnchorRect(event.currentTarget.getBoundingClientRect()));
  };

  const handleContextClose = () => {
    setContextAnchorRect(null);
  };

  const handleHistoryToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isHistoryOpen) {
      setHistoryAnchorRect(null);
      closeHistory();
      return;
    }

    setContextAnchorRect(null);
    setHistoryAnchorRect(toAnchorRect(event.currentTarget.getBoundingClientRect()));
    openHistory();
  };

  const handleHistoryClose = () => {
    setHistoryAnchorRect(null);
    closeHistory();
  };

  const handleSessionSelect = (sessionId: string) => {
    handleHistoryClose();
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
          <ToolbarButton ariaLabel={isContextOpen ? "收起工作区上下文" : "打开工作区上下文"} onClick={handleContextToggle}>
            <Blocks className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton ariaLabel={isHistoryOpen ? "收起历史记录" : "打开历史记录"} onClick={handleHistoryToggle}>
            <History className="h-4 w-4" />
          </ToolbarButton>
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
      <ActionMenu anchorRect={contextAnchorRect} onClose={handleContextClose} width={320}>
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
      </ActionMenu>
      <ActionMenu anchorRect={isHistoryOpen ? historyAnchorRect : null} onClose={handleHistoryClose}>
        <div className="space-y-1">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <ActionMenuItem
                key={session.id}
                active={isActive}
                disabled={isRunning}
                onClick={() => handleSessionSelect(session.id)}
              >
                {session.title}
              </ActionMenuItem>
            );
          })}
        </div>
      </ActionMenu>
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
