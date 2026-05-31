// 会话/运行时核心桶：写作会话工厂、会话类、运行时工具类型、事件、运行时上下文。
export { createWritingAgentSession } from "./session";
export type { CreateWritingAgentSessionOptions } from "./session";
export { WritingAgentSession } from "./sessionCore";
export type {
  QueueMode,
  CompactionReason,
  CompactionResult,
  CompactionRunner,
  RunPromptOptions,
  WritingAgentSessionConfig,
} from "./sessionCore";
export type {
  AgentEvent,
  AgentSessionEvent,
  AgentEventListener,
} from "./events";
export { createAgentRuntime } from "./runtime";
export type {
  ToolResult,
  AgentTool,
  AgentToolInteractiveContext,
  AgentToolExecutionContext,
  AgentRuntimeConfig,
} from "./runtime";
export { hasProviderConfig } from "./writingRuntimeContext";
export type { WritingRuntimeContext } from "./writingRuntimeContext";
export { compactBookSession, NOVEL_COMPACTION_INSTRUCTIONS } from "./compactBookSession";
export type { CompactBookSessionOptions, CompactBookSessionResult } from "./compactBookSession";
