export { testAgentProviderConnection } from "./model-gateway/providerProbe";
export type {
  ProviderConnectionTestResult,
  ProviderConnectionTestStage,
  ProviderConnectionTestStatus,
} from "./model-gateway/providerProbeShared";
// 文本/结构化生成均基于 pi-ai 实现。流式对话由 pi AgentHarness（runtime/）驱动，
// 不再经由本模块——本模块仅保留非流式生成与连接测试两类入口。
export { generateAgentText, generateAgentObject } from "./pi/gateway";
export type { AgentTextGenerationInput, AgentObjectGenerationInput } from "./pi/gateway";


