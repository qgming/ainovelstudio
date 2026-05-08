import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import type { AgentMode, ModeContextMap } from "./modeRules";
import type { PlanningState } from "./planning";
import type { ProjectContextPayload } from "./projectContext";
import type { AgentTool } from "./runtime";
import type { AgentMessage, AgentUsage, AskToolAnswer, AskUserRequest } from "./types";
import type { streamAgentText } from "./modelGateway";

export type WritingToolContext = {
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
  streamFn?: typeof streamAgentText;
  subagentStreamFn?: typeof streamAgentText;
};

export function hasProviderConfig(config: AgentProviderConfig): boolean {
  return Boolean(config.apiKey.trim() && config.baseURL.trim() && config.model.trim());
}
