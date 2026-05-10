import { readWorkspaceTextFile, readWorkspaceTree } from "@features/books/api/bookWorkspaceApi";
import { resolveManualTurnContext } from "@features/agent/lib/manualTurnContext";
import { loadProjectContext } from "@features/agent/lib/projectContext";
import { createWritingAgentSession } from "@features/agent/lib/session";
import { derivePlanningState } from "@features/agent/lib/planning";
import { buildBookWorkspaceTools } from "@features/agent/lib/toolsets/factory";
import { applyAgentCardToolPolicy } from "@features/agent/lib/agentCards";
import type { AgentMode, ModeContextMap } from "@features/agent/lib/modeRules";
import { MODE_CONTROL_TOOL_ID } from "@features/agent/lib/modeControl";
import { deriveFlowWorkflowState, type FlowWorkflowState } from "@features/agent/lib/workflowControl";
import type { AgentMessage, AgentUsage } from "@features/agent/lib/types";
import type { ChatEntry } from "@features/agent/chat/types";
import { useBookWorkspaceStore } from "@features/books/stores/useBookWorkspaceStore";
import { useAgentSettingsStore, type AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { getEnabledSkills, useSkillsStore, type ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import {
  ensureMainAgentMarkdown,
  trackInflightToolRequest,
  type PendingAskState,
} from "./helpers";
import { createAskHandler } from "./askController";
import type { ChatRunStoreAccess, SendMessageRequest } from "./runtimeTypes";

type SessionFactoryParams = ChatRunStoreAccess & {
  abortController: AbortController;
  activeModeId: AgentMode;
  assistantMessageId: string;
  attachUsage: (usage: AgentUsage) => void;
  autopilotGoal: string | null;
  autopilotIteration: number;
  conversationEntries: ChatEntry[];
  conversationHistory: AgentMessage[];
  getLatestMessages: () => AgentMessage[];
  isCurrentRun: () => boolean;
  nextInput: string;
  providerConfig: AgentProviderConfig;
  request: SendMessageRequest;
  runRequestId: string;
  sessionId: string;
  setPendingAsk: (pendingAsk: PendingAskState | null) => void;
};

export async function createRunWritingSession(params: SessionFactoryParams) {
  const workspaceState = useBookWorkspaceStore.getState();
  const enabledSkills = getEnabledSkills(useSkillsStore.getState());
  const defaultAgentMarkdown = await ensureMainAgentMarkdown();
  const manualContext = await resolveManualContext(params, enabledSkills);
  const flowWorkflowState = params.activeModeId === "flow"
    ? deriveFlowWorkflowState(params.getLatestMessages())
    : undefined;
  const projectContext = await loadProjectContext({
    activeFilePath: workspaceState.activeFilePath,
    readFile: readWorkspaceTextFile,
    readTree: readWorkspaceTree,
    taskType: params.activeModeId,
    workspaceRootPath: workspaceState.rootPath,
  });

  return createWritingAgentSession({
    abortController: params.abortController,
    activeFilePath: workspaceState.activeFilePath,
    conversationEntries: params.conversationEntries,
    conversationHistory: params.conversationHistory,
    debugLabel: `chat-session:${params.sessionId}`,
    defaultAgentMarkdown,
    enabledSkills,
    enabledToolIds: getEnabledToolIds(params.activeModeId),
    manualContext,
    mode: params.activeModeId,
    modeContext: buildModeContext(params, flowWorkflowState),
    onAskUser: createAskHandler({
      ...params,
      getSessionId: () => params.sessionId,
      setPendingAsk: params.setPendingAsk,
    }),
    onToolRequestStateChange: ({ requestId, status }) => {
      if (!params.isCurrentRun() && status === "start") return;
      trackInflightToolRequest(params.set, requestId, status === "start" ? "start" : "finish");
    },
    onUsage: params.attachUsage,
    planningState: derivePlanningState(params.getLatestMessages()),
    projectContext,
    providerConfig: params.providerConfig,
    workspaceRootPath: workspaceState.rootPath,
    workspaceTools: buildBookWorkspaceTools({
      flowWorkflowState,
      rootPath: workspaceState.rootPath,
      includeAsk: true,
    }),
  });
}

async function resolveManualContext(
  params: SessionFactoryParams,
  enabledSkills: ResolvedSkill[],
) {
  const selection = params.request.selection;
  if (!selection) return null;
  const workspaceState = useBookWorkspaceStore.getState();
  return resolveManualTurnContext({
    activeFilePath: workspaceState.activeFilePath,
    draftContent: workspaceState.draftContent,
    enabledSkills,
    readFile: readWorkspaceTextFile,
    selection,
    workspaceRootPath: workspaceState.rootPath,
  });
}

function buildModeContext(
  params: SessionFactoryParams,
  flowWorkflowState?: FlowWorkflowState,
): ModeContextMap[AgentMode] | undefined {
  if (params.activeModeId === "flow") return { workflowState: flowWorkflowState };
  if (params.activeModeId !== "autopilot") return undefined;
  return {
    goal: params.autopilotGoal ?? params.nextInput,
    iteration: params.autopilotIteration,
  };
}

function requiresModeControl(mode: AgentMode) {
  return mode === "autopilot" || mode === "flow";
}

function getEnabledToolIds(mode: AgentMode) {
  const enabledToolIds = Object.entries(useAgentSettingsStore.getState().enabledTools)
    .filter(([, value]) => value)
    .map(([id]) => id);
  const toolIds = requiresModeControl(mode) && !enabledToolIds.includes(MODE_CONTROL_TOOL_ID)
    ? [MODE_CONTROL_TOOL_ID, ...enabledToolIds]
    : enabledToolIds;
  return applyAgentCardToolPolicy(mode, toolIds);
}
