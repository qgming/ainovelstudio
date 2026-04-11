import { z } from "zod";
import type { ToolSet } from "ai";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { AgentMessage, AgentPart } from "./types";
import { streamAgentText, defineTool } from "./modelGateway";
import type { AgentTool } from "./runtime";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { selectSubAgentForPrompt } from "./delegation";
import { buildConversationMessages } from "./messageContext";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import { buildSubAgentSystem, buildSystemPrompt, buildUserTurnContent } from "./promptContext";

type RunAgentTurnInput = {
  abortSignal?: AbortSignal;
  activeFilePath: string | null;
  workspaceRootPath?: string | null;
  conversationHistory?: AgentMessage[];
  defaultAgentMarkdown?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  /** 启用的工具 ID 列表 */
  enabledToolIds: string[];
  manualContext?: ManualTurnContextPayload | null;
  prompt: string;
  providerConfig: AgentProviderConfig;
  /** workspace 工具集 */
  workspaceTools: Record<string, AgentTool>;
  /** 可选：用于测试注入的流式调用 */
  _streamFn?: typeof streamAgentText;
  /** 可选：用于测试注入的子代理流式调用 */
  _subagentStreamFn?: typeof streamAgentText;
};

function hasProviderConfig(config: AgentProviderConfig) {
  return Boolean(config.apiKey.trim() && config.baseURL.trim() && config.model.trim());
}


function createSubagentSnapshot({
  detail,
  id,
  name,
  parts,
  status,
  summary,
}: {
  detail?: string;
  id: string;
  name: string;
  parts: AgentPart[];
  status: "running" | "completed" | "failed";
  summary: string;
}): Extract<AgentPart, { type: "subagent" }> {
  return {
    type: "subagent",
    id,
    name,
    status,
    summary,
    detail,
    parts: [...parts],
  };
}

function mergeSubagentInnerParts(parts: AgentPart[], part: AgentPart): AgentPart[] {
  if (part.type === "text-delta") {
    const last = parts[parts.length - 1];
    if (last && last.type === "text") {
      return [...parts.slice(0, -1), { ...last, text: last.text + part.delta }];
    }
    return [...parts, { type: "text", text: part.delta }];
  }

  if (part.type === "reasoning") {
    const last = parts[parts.length - 1];
    if (last && last.type === "reasoning") {
      return [...parts.slice(0, -1), { ...last, detail: last.detail + part.detail }];
    }
    return [...parts, part];
  }

  if (part.type === "tool-result") {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const candidate = parts[index];
      if (candidate?.type === "tool-call" && candidate.toolName === part.toolName && candidate.status === "running") {
        return [
          ...parts.slice(0, index),
          {
            ...candidate,
            status: part.status,
            outputSummary: part.outputSummary,
          },
          ...parts.slice(index + 1),
        ];
      }
    }
  }

  return [...parts, part];
}

async function maybeRunSubAgent(params: {
  abortSignal?: AbortSignal;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  prompt: string;
  providerConfig: AgentProviderConfig;
  streamFn: typeof streamAgentText;
  workspaceTools: Record<string, AgentTool>;
  enabledToolIds: string[];
  onProgress?: (snapshot: AgentPart & { type: "subagent" }) => void;
}): Promise<{ agent: ResolvedAgent; text: string; subagentId: string } | null> {
  const { abortSignal, enabledAgents, enabledSkills, prompt, providerConfig, streamFn, workspaceTools, enabledToolIds, onProgress } = params;
  const matchedAgent = selectSubAgentForPrompt(prompt, enabledAgents);
  if (!matchedAgent) {
    return null;
  }

  const subagentPrompt = [
    "这是父代理拆出的一个局部子任务，请在干净上下文中完成，并只返回必要摘要或结果。",
    "## 子任务请求",
    prompt,
  ].join("\n\n");

  const subagentId = `subagent-${matchedAgent.id}-${Date.now()}`;
  const innerParts: AgentPart[] = [];
  const subagentTools = buildAiSdkTools(workspaceTools, enabledToolIds);

  onProgress?.(
    createSubagentSnapshot({
      id: subagentId,
      name: matchedAgent.name,
      status: "running",
      summary: `已派发子任务：${matchedAgent.name}`,
      parts: innerParts,
    }),
  );

  const result = streamFn({
    abortSignal,
    messages: [{ role: "user", content: subagentPrompt }],
    providerConfig,
    system: buildSubAgentSystem(matchedAgent, enabledSkills),
    tools: Object.keys(subagentTools).length > 0 ? subagentTools : undefined,
  });

  for await (const part of result.fullStream) {
    let mappedPart: AgentPart | null = null;

    switch (part.type) {
      case "text-delta":
        mappedPart = { type: "text-delta", delta: part.text };
        break;
      case "reasoning-delta":
        mappedPart = {
          type: "reasoning",
          summary: "思考中...",
          detail: part.text,
        };
        break;
      case "tool-call":
        mappedPart = {
          type: "tool-call",
          toolName: part.toolName,
          status: "running",
          inputSummary: JSON.stringify(part.input),
        };
        break;
      case "tool-result":
        mappedPart = {
          type: "tool-result",
          toolName: part.toolName,
          status: "completed",
          outputSummary: typeof part.output === "string" ? part.output : JSON.stringify(part.output),
        };
        break;
      default:
        break;
    }

    if (!mappedPart) {
      continue;
    }

    const mergedParts = mergeSubagentInnerParts(innerParts, mappedPart);
    innerParts.splice(0, innerParts.length, ...mergedParts);
    onProgress?.(
      createSubagentSnapshot({
        id: subagentId,
        name: matchedAgent.name,
        status: "running",
        summary: `${matchedAgent.name} 子任务执行中`,
        parts: innerParts,
      }),
    );
  }

  const finalText = innerParts
    .filter((part): part is Extract<AgentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");

  onProgress?.(
    createSubagentSnapshot({
      id: subagentId,
      name: matchedAgent.name,
      status: "completed",
      summary: `${matchedAgent.name} 子任务已完成`,
      detail: finalText,
      parts: innerParts,
    }),
  );

  return {
    agent: matchedAgent,
    text: finalText,
    subagentId,
  };
}

/** 把 workspace 工具转成 AI SDK ToolSet 格式 */
function buildAiSdkTools(
  workspaceTools: Record<string, AgentTool>,
  enabledToolIds: string[],
): ToolSet {
  const toolSet: ToolSet = {};
  const enabledSet = new Set(enabledToolIds);

  if (enabledSet.has("read_file") && workspaceTools.read_file) {
    const wsTool = workspaceTools.read_file;
    toolSet.read_file = defineTool({
      description: "读取完整文本文件内容。仅在你已经知道准确路径、并且需要查看全文上下文时使用；如果还不知道文件或目录在哪里，先用 search_workspace_content 或 read_workspace_tree 缩小范围。",
      inputSchema: z.object({
        path: z.string().describe("工作区内的准确文本文件路径。该工具不会帮你搜索路径，因此未知路径时不要直接调用。"),
      }),
      execute: async (input: { path: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  if (enabledSet.has("line_edit") && workspaceTools.line_edit) {
    const wsTool = workspaceTools.line_edit;
    toolSet.line_edit = defineTool({
      description: "按行读取或替换文本。适合小范围精确修改；get 只读取单行，replace 只替换单行，不会重排其它内容。需要改多行或整篇时不要滥用它。",
      inputSchema: z.object({
        action: z.enum(["get", "replace"]).describe("get 读取单行内容；replace 仅替换这一行，不会跨行编辑。"),
        contents: z.string().optional().describe("仅在 action=replace 时传入。必须是单行文本，不能包含换行符，也不应附带行号。"),
        lineNumber: z.number().int().positive().describe("从 1 开始的目标行号。超出范围会报错，不会自动补行。"),
        path: z.string().describe("要操作的工作区文本文件路径，必须是已经存在的文本文件。"),
      }),
      execute: async (input: { action: "get" | "replace"; contents?: string; lineNumber: number; path: string }) => {
        const result = await wsTool.execute(input as unknown as Record<string, unknown>);
        return result.data ?? result.summary;
      },
    });
  }

  if (enabledSet.has("write_file") && workspaceTools.write_file) {
    const wsTool = workspaceTools.write_file;
    toolSet.write_file = defineTool({
      description: "整文件覆盖写入。适用于你已经准备好文件的完整新内容时；调用后会覆盖原文件全部文本。如果只是小改动，优先使用 line_edit。",
      inputSchema: z.object({
        path: z.string().describe("要覆盖写入的目标文件路径，通常应指向已存在的文本文件。"),
        contents: z.string().describe("文件的新完整内容。会整体覆盖旧内容，不是追加写入。"),
      }),
      execute: async (input: { path: string; contents: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  if (enabledSet.has("create_file") && workspaceTools.create_file) {
    const wsTool = workspaceTools.create_file;
    toolSet.create_file = defineTool({
      description: "在指定目录创建新的文本文件。适合新增文件；如果目标文件已经存在或你只是想修改旧文件内容，不要用它。",
      inputSchema: z.object({
        parentPath: z.string().describe("新文件所在的父目录路径，必须位于工作区内。"),
        name: z.string().describe("要创建的文件名，通常应包含扩展名，如 chapter-01.md。"),
      }),
      execute: async (input: { parentPath: string; name: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  if (enabledSet.has("create_folder") && workspaceTools.create_folder) {
    const wsTool = workspaceTools.create_folder;
    toolSet.create_folder = defineTool({
      description: "在指定目录创建文件夹。适合补齐目录结构，不负责创建文件内容。",
      inputSchema: z.object({
        parentPath: z.string().describe("新文件夹所在的父目录路径，必须位于工作区内。"),
        name: z.string().describe("要创建的文件夹名称，不要传完整路径。"),
      }),
      execute: async (input: { parentPath: string; name: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  if (enabledSet.has("delete_path") && workspaceTools.delete_path) {
    const wsTool = workspaceTools.delete_path;
    toolSet.delete_path = defineTool({
      description: "删除指定文件或目录。只有在你已经确认目标路径和影响范围时才使用，避免把它当清理未知内容的通用手段。",
      inputSchema: z.object({
        path: z.string().describe("工作区内要删除的准确路径。删除目录会递归影响其下内容。"),
      }),
      execute: async (input: { path: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  if (enabledSet.has("search_workspace_content") && workspaceTools.search_workspace_content) {
    const wsTool = workspaceTools.search_workspace_content;
    toolSet.search_workspace_content = defineTool({
      description: "搜索工作区中的目录名、文件名和正文命中，用于定位目标、判断下一步该读哪个文件或改哪个位置。它只返回命中摘要，不返回完整文件内容。",
      inputSchema: z.object({
        limit: z.number().int().positive().max(200).optional().describe("最多返回多少条结果。默认 50，最大 200；范围越大，结果越噪。"),
        query: z.string().describe("搜索关键词，可匹配目录名、文件名和正文内容。建议传短语或关键实体，不要传整段自然语言。"),
      }),
      execute: async (input: { limit?: number; query: string }) => {
        const result = await wsTool.execute(input as unknown as Record<string, unknown>);
        return result.data ?? result.summary;
      },
    });
  }

  if (enabledSet.has("rename_path") && workspaceTools.rename_path) {
    const wsTool = workspaceTools.rename_path;
    toolSet.rename_path = defineTool({
      description: "重命名工作区中的文件或目录。适合改名或整理结构，不会修改文件正文。",
      inputSchema: z.object({
        path: z.string().describe("当前的准确路径，必须已经存在于工作区内。"),
        nextName: z.string().describe("新的文件名或目录名，只传名称本身，不要传完整路径。"),
      }),
      execute: async (input: { path: string; nextName: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  if (enabledSet.has("read_workspace_tree") && workspaceTools.read_workspace_tree) {
    const wsTool = workspaceTools.read_workspace_tree;
    toolSet.read_workspace_tree = defineTool({
      description: "读取当前工作区的目录树。适合先了解目录结构、入口文件和层级关系；它不会搜索文件正文。",
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>) => {
        const result = await wsTool.execute({});
        return result.data ?? result.summary;
      },
    });
  }

  return toolSet;
}

function createSystemMessage(text: string): AgentMessage {
  return {
    id: `system-${Date.now()}`,
    role: "system",
    author: "系统",
    parts: [{ type: "text", text }],
  };
}

/**
 * 运行一轮 agent 对话，以 async generator 形式逐步 yield AgentPart。
 * 调用方可实时消费每个 part 更新 UI。
 */
export async function* runAgentTurn({
  abortSignal,
  activeFilePath,
  workspaceRootPath,
  conversationHistory = [],
  defaultAgentMarkdown,
  enabledAgents,
  enabledSkills,
  enabledToolIds,
  manualContext,
  prompt,
  providerConfig,
  workspaceTools,
  _streamFn = streamAgentText,
  _subagentStreamFn = streamAgentText,
}: RunAgentTurnInput): AsyncGenerator<AgentPart> {
  const progressQueue: AgentPart[] = [];
  if (!hasProviderConfig(providerConfig)) {
    yield { type: "text", text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。" };
    return;
  }

  const aiTools = buildAiSdkTools(workspaceTools, enabledToolIds);
  const system = buildSystemPrompt({
    defaultAgentMarkdown,
    enabledAgents,
    enabledSkills,
    enabledToolIds,
  });

  const maybeSubAgent = await maybeRunSubAgent({
    abortSignal,
    enabledAgents,
    enabledSkills,
    prompt,
    providerConfig,
    streamFn: _subagentStreamFn,
    workspaceTools,
    enabledToolIds,
    onProgress: (snapshot) => {
      progressQueue.push(snapshot);
    },
  });

  while (progressQueue.length > 0) {
    const snapshot = progressQueue.shift();
    if (snapshot) {
      yield snapshot;
    }
  }

  const userContent = buildUserTurnContent({
    activeFilePath,
    manualContext,
    workspaceRootPath,
    prompt,
    subagentAnalysis: maybeSubAgent
      ? {
          agentName: maybeSubAgent.agent.name,
          text: maybeSubAgent.text,
        }
      : null,
  });

  const result = _streamFn({
    abortSignal,
    messages: buildConversationMessages(conversationHistory, userContent),
    providerConfig,
    system,
    tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        yield { type: "text-delta", delta: part.text };
        break;

      case "reasoning-delta":
        yield {
          type: "reasoning",
          summary: "思考中...",
          detail: part.text,
        };
        break;

      case "tool-call":
        yield {
          type: "tool-call",
          toolName: part.toolName,
          status: "running",
          inputSummary: JSON.stringify(part.input),
        };
        break;

      case "tool-result":
        yield {
          type: "tool-result",
          toolName: part.toolName,
          status: "completed",
          outputSummary: typeof part.output === "string" ? part.output : JSON.stringify(part.output),
        };
        break;

      default:
        break;
    }
  }
}

export { createSystemMessage };










