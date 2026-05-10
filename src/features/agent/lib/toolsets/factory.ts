/**
 * Agent 工具集装配工厂。
 *
 * 项目内有两处需要为 agent 运行时拼装 `workspaceTools` 字段：
 *   1. 写作模式（useChatRunStore.sendMessage）
 * 目前写作模式使用 global + workspace + localResource，工厂统一管控
 * skills 注册表刷新与工作区刷新副作用。
 */

import { useSkillsStore } from "@features/skills/stores/useSkillsStore";
import { useBookWorkspaceStore } from "@features/books/stores/useBookWorkspaceStore";
import {
  createGlobalToolset,
  createLocalResourceToolset,
  createWorkspaceToolset,
} from "../tools";
import type { AgentTool } from "../runtime";
import type { FlowWorkflowState } from "../workflowControl";

export type AgentToolMap = Record<string, AgentTool>;

export function createDefaultLocalResourceToolset(options?: {
  includeAsk?: boolean;
}): AgentToolMap {
  const localTools = createLocalResourceToolset({
    refreshSkills: async () => {
      await useSkillsStore.getState().refresh();
    },
  });

  if (options?.includeAsk === false) {
    const { ask: _ask, ...rest } = localTools;
    return rest;
  }

  return localTools;
}

/**
 * 默认书籍工作区工具集装配：在工作区文件被工具修改后刷新视图。
 *
 * @param options.rootPath 当前会话绑定的工作区根路径；为 null/空字符串时返回空集。
 * @param options.guardRootMatch 是否仅当当前 store rootPath 与传入 rootPath 一致时才刷新。
 */
export function createDefaultBookWorkspaceToolset(options: {
  rootPath: string | null;
  guardRootMatch?: boolean;
}): AgentToolMap {
  const { rootPath, guardRootMatch = false } = options;
  if (!rootPath) {
    return {};
  }
  return createWorkspaceToolset({
    rootPath,
    onWorkspaceMutated: async () => {
      const workspaceState = useBookWorkspaceStore.getState();
      if (guardRootMatch && workspaceState.rootPath !== rootPath) {
        return;
      }
      await workspaceState.refreshWorkspaceAfterExternalChange();
    },
  });
}

/**
 * 写作模式（书籍工作区）默认 toolset：global + workspace + localResource。
 *
 * @param options.rootPath 当前书籍工作区根路径；为空时仅返回 global + localResource。
 */
export function buildBookWorkspaceTools(options: {
  rootPath: string | null;
  flowWorkflowState?: FlowWorkflowState;
  guardRootMatch?: boolean;
  includeAsk?: boolean;
}): AgentToolMap {
  return {
    ...createGlobalToolset({ flowWorkflowState: options.flowWorkflowState }),
    ...createDefaultBookWorkspaceToolset({
      rootPath: options.rootPath,
      guardRootMatch: options.guardRootMatch,
    }),
    ...createDefaultLocalResourceToolset({
      includeAsk: options.includeAsk,
    }),
  };
}
