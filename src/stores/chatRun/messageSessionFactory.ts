import { readWorkspaceTextFile, readWorkspaceTree } from "../../lib/bookWorkspace/api";
import { resolveManualTurnContext } from "../../lib/agent/manualTurnContext";
import { loadProjectContext } from "../../lib/agent/projectContext";
import { createWritingAgentSession } from "../../lib/agent/session";
import { derivePlanningState } from "../../lib/agent/planning";
import { buildBookWorkspaceTools } from "../../lib/agent/toolsets/factory";
import type { AgentMode, ModeContextMap } from "../../lib/agent/modeRules";
import type { AgentMessage, AgentUsage } from "../../lib/agent/types";
import type { ChatEntry } from "../../lib/chat/types";
import { useBookWorkspaceStore } from "../bookWorkspaceStore";
import { useAgentSettingsStore, type AgentProviderConfig } from "../agentSettingsStore";
import { getEnabledSkills, useSkillsStore, type ResolvedSkill } from "../skillsStore";
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
  const projectContext = await loadProjectContext({
    readFile: readWorkspaceTextFile,
    readTree: readWorkspaceTree,
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
    enabledToolIds: getEnabledToolIds(),
    manualContext,
    mode: params.activeModeId,
    modeContext: buildModeContext(params),
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
    workspaceTools: buildBookWorkspaceTools({ rootPath: workspaceState.rootPath, includeAsk: true }),
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

function buildModeContext(params: SessionFactoryParams): ModeContextMap[AgentMode] | undefined {
  if (params.activeModeId !== "autopilot") return undefined;
  return {
    goal: params.autopilotGoal ?? params.nextInput,
    iteration: params.autopilotIteration,
  };
}

function getEnabledToolIds() {
  return Object.entries(useAgentSettingsStore.getState().enabledTools)
    .filter(([, value]) => value)
    .map(([id]) => id);
}
