import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ManualTurnContextPayload } from "../prompt-context/manualTurnContext";
import type { AgentMode, ModeContextMap } from "../modes/modeRules";
import type { GoalRuntimeState } from "../domain/goalControl";
import type { PlanningState } from "../modes/planning";
import type { ProjectContextPayload } from "../prompt-context/projectContext";
import type { AgentTool } from "./runtime";
import type { AgentMessage, AgentUsage, AskToolAnswer, AskUserRequest } from "../types";

export type WritingRuntimeContext = {
  activeFilePath: string | null;
  conversationEntries?: unknown[];
  conversationHistory?: AgentMessage[];
  debugLabel?: string;
  defaultAgentMarkdown?: string;
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  manualContext?: ManualTurnContextPayload | null;
  mode?: AgentMode;
  modeContext?: ModeContextMap[AgentMode];
  planningState?: PlanningState | null;
  projectContext?: ProjectContextPayload | null;
  providerConfig: AgentProviderConfig;
  // 解析用：书籍标识（UUID），透传给 env/session 适配器作为 bookWorkspaceApi 解析 key。
  workspaceBookId?: string | null;
  // 展示用：可读工作区根串（books/<书名>），注入系统提示/材料上下文供模型阅读。
  workspaceRootPath?: string | null;
  workspaceTools: Record<string, AgentTool>;
  onAskUser?: (event: {
    request: AskUserRequest;
    toolCallId: string;
  }) => Promise<AskToolAnswer>;
  onToolRequestStateChange?: (event: {
    requestId: string;
    status: "start" | "finish";
  }) => void;
  onUsage?: (usage: AgentUsage) => void;
  onGoalStateChange?: (state: GoalRuntimeState) => void;
  // 测试注入用：pi-agent-core 的 StreamFn（替代 pi 默认的 streamSimple）。
  streamFn?: StreamFn;
};

export function hasProviderConfig(config: AgentProviderConfig): boolean {
  return Boolean(config.apiKey.trim() && config.baseURL.trim() && config.model.trim());
}
