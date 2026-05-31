import {
  listEntryRelations,
  readWorkspaceTextFile,
  readWorkspaceTree,
} from "@features/books/api/bookWorkspaceApi";
import { resolveManualTurnContext } from "@features/agent/lib/prompt-context/manualTurnContext";
import { loadProjectContext } from "@features/agent/lib/prompt-context/projectContext";
import { createWritingAgentSession, compactBookSession } from "@features/agent/lib/session";
import { derivePlanningState } from "@features/agent/lib/modes/planning";
import { buildBookWorkspaceTools } from "@features/agent/lib/builtin-tools/factory";
import type { AgentMode, ModeContextMap } from "@features/agent/lib/modes/modeRules";
import { getModeConfig } from "@features/agent/lib/modes";
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
  // bookId(UUID) 为解析 key；displayPath(books/<书名>) 为路径前缀/展示串。
  const bookId = workspaceState.rootBookId;
  const displayPath = workspaceState.rootPath;
  const enabledSkills = getEnabledSkills(useSkillsStore.getState());
  const defaultAgentMarkdown = await ensureMainAgentMarkdown();
  const manualContext = await resolveManualContext(params, enabledSkills);
  const projectContext = await loadProjectContext({
    activeFilePath: workspaceState.activeFilePath,
    readFile: readWorkspaceTextFile,
    // 把后端 RelationDto 映射成 projectContext 需要的精简形态:对端路径 + 标签 + 备注。
    // 由于关联是无向边,根据 active file 的相对路径推断对端在 a/b 哪侧。
    // 注意：listEntryRelations 的解析 key 是 bookId；路径前缀剥离/拼接用 displayPath。
    readRelations: async (apiBookId, entryPath) => {
      const relations = await listEntryRelations(apiBookId, entryPath);
      const rootPrefix = displayPath ? `${displayPath}/` : "";
      // active file 是 display path,后端入参也是 display,内部转 relative 后返回 relative。
      // 因此 self 的相对路径 = activeFilePath 去掉 displayPath 前缀。
      const selfRelative = rootPrefix && entryPath.startsWith(rootPrefix)
        ? entryPath.slice(rootPrefix.length)
        : entryPath;
      return relations.map((relation) => {
        const otherRelative = relation.entryAPath === selfRelative
          ? relation.entryBPath
          : relation.entryAPath;
        return {
          note: relation.note,
          // 拼回 display path,使得 projectContext 的描述里展示完整工作区路径,AI 可直接 read。
          otherEntryPath: otherRelative ? `${rootPrefix}${otherRelative}` : (displayPath ?? ""),
          relationship: relation.relationship,
        };
      });
    },
    readTree: readWorkspaceTree,
    taskType: params.activeModeId,
    workspaceBookId: bookId,
  });

  return createWritingAgentSession({
    abortController: params.abortController,
    activeFilePath: workspaceState.activeFilePath,
    conversationEntries: params.conversationEntries,
    conversationHistory: params.conversationHistory,
    debugLabel: `chat-session:${params.sessionId}`,
    sessionId: params.sessionId,
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
    // workspaceBookId 给 env/session 解析；workspaceRootPath 给系统提示/材料展示。
    workspaceBookId: bookId,
    workspaceRootPath: displayPath,
    workspaceTools: buildBookWorkspaceTools({
      bookId,
      displayPath,
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
    workspaceBookId: workspaceState.rootBookId,
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

// CP-F：工具白名单过滤统一走 ModeConfig（lib/modes），不再在此重复 yolo_control 收敛逻辑。
function getEnabledToolIds(mode: AgentMode) {
  const allEnabled = Object.entries(useAgentSettingsStore.getState().enabledTools)
    .filter(([, value]) => value)
    .map(([id]) => id);
  return getModeConfig(mode).tools.filterEnabledToolIds(allEnabled);
}

// 手动压缩：复用 pi 原生 compact() 压缩持久 jsonl 会话。
// 只需 harness 静态装配所需的最小上下文（provider/tools/skills/人设），物料类上下文
//（projectContext/manualContext/planning）对 compact 无意义，故不构造，保持轻量。
export async function runManualCompaction(params: {
  sessionId: string;
  providerConfig: AgentProviderConfig;
  mode: AgentMode;
}) {
  const workspaceState = useBookWorkspaceStore.getState();
  const bookId = workspaceState.rootBookId;
  const displayPath = workspaceState.rootPath;
  // 无打开工作区时无可压缩的持久会话，静默跳过（与旧实现「无结果即返回」一致）。
  if (!bookId) return null;

  const enabledSkills = getEnabledSkills(useSkillsStore.getState());
  const defaultAgentMarkdown = await ensureMainAgentMarkdown();

  return compactBookSession({
    sessionId: params.sessionId,
    bookId,
    displayPath: displayPath ?? "",
    toolContext: {
      activeFilePath: workspaceState.activeFilePath,
      defaultAgentMarkdown,
      enabledSkills,
      enabledToolIds: getEnabledToolIds(params.mode),
      mode: params.mode,
      providerConfig: params.providerConfig,
      workspaceBookId: bookId,
      workspaceRootPath: displayPath,
      workspaceTools: buildBookWorkspaceTools({ bookId, displayPath, includeAsk: true }),
    },
  });
}
