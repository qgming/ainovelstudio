/**
 * Agent 工具集装配工厂。
 *
 * 项目内有三处需要为 agent 运行时拼装 `workspaceTools` 字段：
 *   1. 写作模式（chatRunStore.sendMessage）
 *   2. 工作流引擎（workflow/engine.executeConfiguredStep）
 *   3. 扩写工作区（pages/ExpansionDetailPage.runWorkspaceAgentAction）
 *
 * 这三处之前各自 `createGlobalToolset() + createLocalResourceToolset(...) + createWorkspaceToolset(...)`，
 * 其中 store 与 engine 的 localResource 装配字节级重复，仅 workspaceMutated 守卫不同。
 *
 * 本模块以"模式工厂"形式收敛：调用方只声明意图（写作 / 扩写、是否需 rootPath 匹配守卫等），
 * 内部统一管控 sub-agent / skills 注册表刷新等通用副作用，避免再次散落。
 */

import { useSubAgentStore } from "../../../stores/subAgentStore";
import { useSkillsStore } from "../../../stores/skillsStore";
import { useBookWorkspaceStore } from "../../../stores/bookWorkspaceStore";
import {
  createGlobalToolset,
  createLocalResourceToolset,
  createWorkspaceToolset,
} from "../tools";
import { createExpansionAgentToolset } from "../../expansion/agentToolset";
import { createExpansionSemanticToolset } from "../../expansion/semanticToolset";
import type { AgentTool } from "../runtime";
import type { WorkflowDecisionResult } from "../../workflow/types";

export type AgentToolMap = Record<string, AgentTool>;

/**
 * 默认本地资源工具集装配：刷新子 agent / 技能注册表。
 *
 * @param options.onWorkflowDecision 仅工作流的 decision 节点用于回填决策结果。
 */
export function createDefaultLocalResourceToolset(options?: {
  onWorkflowDecision?: (decision: WorkflowDecisionResult) => void;
  includeAsk?: boolean;
}): AgentToolMap {
  const localTools = createLocalResourceToolset({
    refreshAgents: async () => {
      await useSubAgentStore.getState().refresh();
    },
    refreshSkills: async () => {
      await useSkillsStore.getState().refresh();
    },
    onWorkflowDecision: options?.onWorkflowDecision,
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
 *   工作流引擎需要该守卫（步骤运行期间用户可能切换书籍工作区）；写作模式始终是同一个工作区，无需守卫。
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
 * @param options.guardRootMatch 见 {@link createDefaultBookWorkspaceToolset}，工作流场景需置 true。
 * @param options.onWorkflowDecision 仅 workflow decision 节点使用。
 */
export function buildBookWorkspaceTools(options: {
  rootPath: string | null;
  guardRootMatch?: boolean;
  onWorkflowDecision?: (decision: WorkflowDecisionResult) => void;
  includeAsk?: boolean;
}): AgentToolMap {
  return {
    ...createGlobalToolset(),
    ...createDefaultBookWorkspaceToolset({
      rootPath: options.rootPath,
      guardRootMatch: options.guardRootMatch,
    }),
    ...createDefaultLocalResourceToolset({
      includeAsk: options.includeAsk,
      onWorkflowDecision: options.onWorkflowDecision,
    }),
  };
}

/**
 * 扩写模式默认 toolset：global + localResource + 扩写 agent + 扩写语义。
 *
 * 注意：扩写模式不使用书籍工作区的文件工具，而是通过虚拟 `expansion://` 命名空间的专用工具。
 *
 * @param options.workspaceId 扩写工作区 id。
 * @param options.onWorkspaceMutated 当扩写文件被工具修改时回调（页面据此 reload）。
 */
export function buildExpansionTools(options: {
  workspaceId: string;
  onWorkspaceMutated: () => Promise<void>;
}): AgentToolMap {
  const { workspaceId, onWorkspaceMutated } = options;
  return {
    ...createGlobalToolset(),
    ...createDefaultLocalResourceToolset({ includeAsk: false }),
    ...createExpansionAgentToolset({
      workspaceId,
      onWorkspaceMutated,
    }),
    ...createExpansionSemanticToolset({
      workspaceId,
      onWorkspaceMutated,
    }),
  };
}
