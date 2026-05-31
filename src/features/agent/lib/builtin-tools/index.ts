// 内置工具实现层桶：底层工具集 + 装配工厂（factory）。
export { createGlobalToolset } from "./globalToolset";
export { createLocalResourceToolset } from "./resourceToolset";
export { createWorkspaceToolset } from "./workspaceToolset";
export {
  buildBookWorkspaceTools,
  createDefaultBookWorkspaceToolset,
  createDefaultLocalResourceToolset,
} from "./factory";
export type { AgentToolMap } from "./factory";
