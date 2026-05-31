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
import { createGlobalToolset } from "./globalToolset";
import { createLocalResourceToolset } from "./resourceToolset";
import { createWorkspaceToolset } from "./workspaceToolset";
import type { AgentTool } from "../session/runtime";

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
    const { ask_user: _ask, ...rest } = localTools;
    return rest;
  }

  return localTools;
}

/**
 * 默认书籍工作区工具集装配：在工作区文件被工具修改后刷新视图。
 *
 * @param options.bookId 当前会话绑定的书籍标识（UUID，传给 bookWorkspaceApi 的解析 key）；为 null/空字符串时返回空集。
 * @param options.displayPath 工作区可读根串（books/<书名>），用于工具内的路径前缀解析与渲染。
 * @param options.guardRootMatch 是否仅当当前 store rootBookId 与传入 bookId 一致时才刷新。
 */
export function createDefaultBookWorkspaceToolset(options: {
  bookId: string | null;
  displayPath: string | null;
  guardRootMatch?: boolean;
}): AgentToolMap {
  const { bookId, displayPath, guardRootMatch = false } = options;
  if (!bookId) {
    return {};
  }
  return createWorkspaceToolset({
    bookId,
    displayPath: displayPath ?? "",
    onWorkspaceMutated: async () => {
      const workspaceState = useBookWorkspaceStore.getState();
      // 守卫比较解析 key（rootBookId）而非展示串：用户切书时 bookId 才是稳定身份。
      if (guardRootMatch && workspaceState.rootBookId !== bookId) {
        return;
      }
      await workspaceState.refreshWorkspaceAfterExternalChange();
    },
  });
}

/**
 * 写作模式（书籍工作区）默认 toolset：global + workspace + localResource。
 *
 * @param options.bookId 当前书籍标识（UUID）；为空时仅返回 global + localResource。
 * @param options.displayPath 工作区可读根串（books/<书名>），供工具路径渲染。
 */
export function buildBookWorkspaceTools(options: {
  bookId: string | null;
  displayPath: string | null;
  guardRootMatch?: boolean;
  includeAsk?: boolean;
}): AgentToolMap {
  return {
    ...createGlobalToolset(),
    ...createDefaultBookWorkspaceToolset({
      bookId: options.bookId,
      displayPath: options.displayPath,
      guardRootMatch: options.guardRootMatch,
    }),
    ...createDefaultLocalResourceToolset({
      includeAsk: options.includeAsk,
    }),
  };
}
