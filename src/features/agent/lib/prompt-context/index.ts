// 提示词/上下文构建桶：系统提示、轮次提示、项目上下文、手动轮次上下文。
// 上下文压缩已统一改用 pi 原生 harness.compact()（见 lib/session/compactBookSession 与
// writingAgentHarnessRunner 的 maybeCompactSession），不再有自研压缩模块。
export { DEFAULT_MAIN_AGENT_MARKDOWN, buildSystemPrompt } from "./systemPrompt";
export { buildRuntimeControlBlock, buildUserTurnContent } from "./turnPrompt";
export * from "./projectContext";
export * from "./manualTurnContext";
