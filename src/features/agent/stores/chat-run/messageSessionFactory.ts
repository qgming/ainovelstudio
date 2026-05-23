import {
  listEntryRelations,
  readWorkspaceTextFile,
  readWorkspaceTree,
} from "@features/books/api/bookWorkspaceApi";
import { resolveManualTurnContext } from "@features/agent/lib/manualTurnContext";
import { loadProjectContext } from "@features/agent/lib/projectContext";
import { createWritingAgentSession } from "@features/agent/lib/session";
import { derivePlanningState } from "@features/agent/lib/planning";
import { buildBookWorkspaceTools } from "@features/agent/lib/toolsets/factory";
import type { AgentMode, ModeContextMap } from "@features/agent/lib/modeRules";
import { YOLO_CONTROL_TOOL_ID } from "@features/agent/lib/yoloControl";
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
  const projectContext = await loadProjectContext({
    activeFilePath: workspaceState.activeFilePath,
    readFile: readWorkspaceTextFile,
    // 把后端 RelationDto 映射成 projectContext 需要的精简形态:对端路径 + 标签 + 备注。
    // 由于关联是无向边,根据 active file 的相对路径推断对端在 a/b 哪侧。
    readRelations: async (rootPath, entryPath) => {
      const relations = await listEntryRelations(rootPath, entryPath);
      const rootPrefix = `${rootPath}/`;
      // active file 是 display path,后端入参也是 display,内部转 relative 后返回 relative。
      // 因此 self 的相对路径 = activeFilePath 去掉前缀。
      const selfRelative = entryPath.startsWith(rootPrefix)
        ? entryPath.slice(rootPrefix.length)
        : entryPath;
      return relations.map((relation) => {
        const otherRelative = relation.entryAPath === selfRelative
          ? relation.entryBPath
          : relation.entryAPath;
        return {
          note: relation.note,
          // 拼回 display path,使得 projectContext 的描述里展示完整工作区路径,AI 可直接 read。
          otherEntryPath: otherRelative ? `${rootPrefix}${otherRelative}` : rootPath,
          relationship: relation.relationship,
        };
      });
    },
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
    workspaceTools: buildBookWorkspaceTools({
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
): ModeContextMap[AgentMode] | undefined {
  if (params.activeModeId !== "autopilot") return undefined;
  return {
    goal: params.autopilotGoal ?? params.nextInput,
    iteration: params.autopilotIteration,
  };
}

function getRequiredControlToolId(mode: AgentMode) {
  if (mode === "autopilot") return YOLO_CONTROL_TOOL_ID;
  return null;
}

function getEnabledToolIds(mode: AgentMode) {
  const requiredControlToolId = getRequiredControlToolId(mode);
  const enabledToolIds = Object.entries(useAgentSettingsStore.getState().enabledTools)
    .filter(([, value]) => value)
    .map(([id]) => id)
    .filter((id) => {
      if (id !== YOLO_CONTROL_TOOL_ID) return true;
      return id === requiredControlToolId;
    });
  if (requiredControlToolId && !enabledToolIds.includes(requiredControlToolId)) {
    return [requiredControlToolId, ...enabledToolIds];
  }
  return enabledToolIds;
}
