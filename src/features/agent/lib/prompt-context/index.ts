// 提示词/上下文构建桶：系统提示、轮次提示、项目上下文、手动轮次上下文、上下文压缩。
export { DEFAULT_MAIN_AGENT_MARKDOWN, buildSystemPrompt } from "./systemPrompt";
export { buildRuntimeControlBlock, buildUserTurnContent } from "./turnPrompt";
export * from "./projectContext";
export * from "./manualTurnContext";
export * from "./contextCompaction";
