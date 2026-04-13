import {
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  readWorkspaceTextFile,
  readWorkspaceTextLine,
  readWorkspaceTree,
  renameWorkspaceEntry,
  replaceWorkspaceTextLine,
  searchWorkspaceContent,
  writeWorkspaceTextFile,
} from "../bookWorkspace/api";
import { readAgentFileContent, scanInstalledAgents } from "../agents/api";
import { readSkillFileContent, scanInstalledSkills } from "../skills/api";
import type { WorkspaceSearchMatch } from "../bookWorkspace/types";
import { renderPlanItems, type PlanItem, type PlanItemStatus } from "./planning";
import type { AgentTool, AgentToolExecutionContext, ToolResult } from "./runtime";

type WorkspaceToolContext = {
  onWorkspaceMutated?: () => Promise<void>;
  rootPath: string;
};

function getAbortContext(context?: AgentToolExecutionContext) {
  if (!context?.abortSignal && !context?.requestId) {
    return undefined;
  }

  return {
    abortSignal: context.abortSignal,
    requestId: context.requestId,
  };
}

function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
}

function formatLinePreview(text: string) {
  return text.length > 0 ? text : "(空行)";
}

function formatSearchSummary(query: string, matches: WorkspaceSearchMatch[]) {
  if (matches.length === 0) {
    return `未找到与“${query}”相关的文件夹、文件名或正文内容。`;
  }

  return [
    `共找到 ${matches.length} 条与“${query}”相关的结果：`,
    ...matches.map((match) => {
      if (match.matchType === "content") {
        return `- [内容] ${match.path}:${match.lineNumber} ${match.lineText ?? ""}`.trimEnd();
      }

      const label = match.matchType === "directory_name" ? "文件夹" : "文件名";
      return `- [${label}] ${match.path}`;
    }),
  ].join("\n");
}

type LocalResourceToolContext = {
  refreshAgents?: () => Promise<void>;
  refreshSkills?: () => Promise<void>;
};

function normalizePlanItemStatus(value: unknown): PlanItemStatus {
  return value === "completed" || value === "in_progress" || value === "pending" ? value : "pending";
}

function normalizeTodoItems(items: unknown): PlanItem[] {
  if (!Array.isArray(items)) {
    throw new Error("todo.items 必须是数组。");
  }

  const validated = items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`todo.items[${index}] 必须是对象。`);
    }

    const content = String(item.content ?? "").trim();
    if (!content) {
      throw new Error(`todo.items[${index}].content 不能为空。`);
    }

    return {
      activeForm: String(item.activeForm ?? "").trim(),
      content,
      status: normalizePlanItemStatus(item.status),
    };
  });

  const inProgressCount = validated.filter((item) => item.status === "in_progress").length;
  if (inProgressCount > 1) {
    throw new Error("Only one item can be in_progress");
  }

  return validated;
}

export function createWorkspaceToolset({ onWorkspaceMutated, rootPath }: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    create_file: {
      description: "在指定目录中创建文本文件",
      execute: async (input, context) => {
        const parentPath = String(input.parentPath ?? "");
        const name = String(input.name ?? "");
        const createdPath = await createWorkspaceTextFile(rootPath, parentPath, name, getAbortContext(context));
        await onWorkspaceMutated?.();
        return ok(`已创建文件 ${createdPath}`);
      },
    },
    create_folder: {
      description: "在指定目录中创建文件夹",
      execute: async (input, context) => {
        const parentPath = String(input.parentPath ?? "");
        const name = String(input.name ?? "");
        const createdPath = await createWorkspaceDirectory(rootPath, parentPath, name, getAbortContext(context));
        await onWorkspaceMutated?.();
        return ok(`已创建文件夹 ${createdPath}`);
      },
    },
    delete_path: {
      description: "删除指定文件或目录",
      execute: async (input, context) => {
        const path = String(input.path ?? "");
        await deleteWorkspaceEntry(rootPath, path, getAbortContext(context));
        await onWorkspaceMutated?.();
        return ok(`已删除 ${path}`);
      },
    },
    line_edit: {
      description: "按行读取或替换指定文件中的文本内容",
      execute: async (input, context) => {
        const action = String(input.action ?? "get");
        const path = String(input.path ?? "");
        const lineNumber = Number(input.lineNumber ?? 0);

        if (action === "replace") {
          const contents = String(input.contents ?? "");
          const previousLine = input.previousLine == null ? undefined : String(input.previousLine);
          const nextLine = input.nextLine == null ? undefined : String(input.nextLine);
          const result = await replaceWorkspaceTextLine(rootPath, path, lineNumber, contents, {
            nextLine,
            previousLine,
          }, getAbortContext(context));
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${result.path} 第 ${result.lineNumber} 行：${formatLinePreview(result.text)}`,
            result,
          );
        }

        const result = await readWorkspaceTextLine(rootPath, path, lineNumber, getAbortContext(context));
        return ok(
          `${result.path} 第 ${result.lineNumber} 行：${formatLinePreview(result.text)}`,
          result,
        );
      },
    },
    read_file: {
      description: "读取指定文本文件内容",
      execute: async (input, context) => {
        const path = String(input.path ?? "");
        const content = await readWorkspaceTextFile(rootPath, path, getAbortContext(context));
        return ok(content);
      },
    },
    read_workspace_tree: {
      description: "读取当前工作区目录树",
      execute: async (_input, context) => {
        const tree = await readWorkspaceTree(rootPath, getAbortContext(context));
        return ok(`已读取工作区 ${tree.name}`, tree);
      },
    },
    rename: {
      description: "重命名工作区文件夹或文件",
      execute: async (input, context) => {
        const path = String(input.path ?? "");
        const nextName = String(input.nextName ?? "");
        const nextPath = await renameWorkspaceEntry(rootPath, path, nextName, getAbortContext(context));
        await onWorkspaceMutated?.();
        return ok(`已重命名为 ${nextPath}`);
      },
    },
    search_workspace_content: {
      description: "搜索文件夹名、文件名和文件正文，并返回命中路径与行信息",
      execute: async (input, context) => {
        const query = String(input.query ?? "");
        const limit =
          typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.trunc(input.limit)
            : undefined;
        const matches = await searchWorkspaceContent(rootPath, query, limit, getAbortContext(context));
        return ok(formatSearchSummary(query, matches), matches);
      },
    },
    write_file: {
      description: "将内容写回文本文件",
      execute: async (input, context) => {
        const path = String(input.path ?? "");
        const contents = String(input.contents ?? "");
        await writeWorkspaceTextFile(rootPath, path, contents, getAbortContext(context));
        await onWorkspaceMutated?.();
        return ok(`已写入 ${path}`);
      },
    },
  };
}

export function createLocalResourceToolset({
  refreshAgents,
  refreshSkills,
}: LocalResourceToolContext = {}): Record<string, AgentTool> {
  return {
    todo: {
      description: "更新当前会话中的待办计划",
      execute: async (input) => {
        const items = normalizeTodoItems(input.items);
        const rendered = renderPlanItems(items);
        return ok(rendered || "当前计划已清空。", {
          items,
          rendered,
        });
      },
    },
    list_agents: {
      description: "列出当前本地可用代理",
      execute: async (_input, context) => {
        await refreshAgents?.();
        const agents = await scanInstalledAgents(getAbortContext(context));
        const data = agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          sourceKind: agent.sourceKind,
          files: ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
        }));
        return ok(`已读取 ${data.length} 个代理`, data);
      },
    },
    list_skills: {
      description: "列出当前本地可用技能",
      execute: async (_input, context) => {
        await refreshSkills?.();
        const skills = await scanInstalledSkills(getAbortContext(context));
        const data = skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          sourceKind: skill.sourceKind,
          files: ["SKILL.md", ...skill.references.map((entry) => entry.path)],
        }));
        return ok(`已读取 ${data.length} 个技能`, data);
      },
    },
    read_agent_file: {
      description: "读取指定代理文件",
      execute: async (input, context) => {
        const agentId = String(input.agentId ?? "");
        const relativePath = String(input.relativePath ?? "");
        const content = await readAgentFileContent(agentId, relativePath, getAbortContext(context));
        return ok(content);
      },
    },
    read_skill_file: {
      description: "读取指定技能文件",
      execute: async (input, context) => {
        const skillId = String(input.skillId ?? "");
        const relativePath = String(input.relativePath ?? "");
        const content = await readSkillFileContent(skillId, relativePath, getAbortContext(context));
        return ok(content);
      },
    },
  };
}
