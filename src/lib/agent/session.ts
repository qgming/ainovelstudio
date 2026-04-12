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
import { getPlanningIntervention, type PlanningState } from "./planning";

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
  planningState?: PlanningState | null;
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

function createAbortError() {
  return new DOMException("Agent execution aborted.", "AbortError");
}

async function withAbort<T>(abortSignal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
  if (!abortSignal) {
    return task();
  }

  if (abortSignal.aborted) {
    throw createAbortError();
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError());
    abortSignal.addEventListener("abort", handleAbort, { once: true });

    task()
      .then((value) => {
        abortSignal.removeEventListener("abort", handleAbort);
        resolve(value);
      })
      .catch((error) => {
        abortSignal.removeEventListener("abort", handleAbort);
        reject(error);
      });
  });
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
      if (candidate?.type === "tool-call" && candidate.toolCallId === part.toolCallId && candidate.status === "running") {
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

async function runSubAgentTask(params: {
  abortSignal?: AbortSignal;
  agentId?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  taskPrompt: string;
  providerConfig: AgentProviderConfig;
  streamFn: typeof streamAgentText;
  workspaceTools: Record<string, AgentTool>;
  enabledToolIds: string[];
  onProgress?: (snapshot: AgentPart & { type: "subagent" }) => void;
}): Promise<{ agent: ResolvedAgent; text: string; subagentId: string }> {
  const { abortSignal, agentId, enabledAgents, enabledSkills, taskPrompt, providerConfig, streamFn, workspaceTools, enabledToolIds, onProgress } = params;
  const explicitAgent = agentId ? enabledAgents.find((agent) => agent.id === agentId) ?? null : null;
  if (agentId && !explicitAgent) {
    throw new Error(`未找到可用子代理：${agentId}`);
  }
  const matchedAgent =
    explicitAgent ??
    (enabledAgents.length === 1
      ? enabledAgents[0]
      : selectSubAgentForPrompt(taskPrompt, enabledAgents));
  if (!matchedAgent) {
    throw new Error("无法确定子代理，请在 task.agentId 中指定目标代理 ID。");
  }

  const subagentPrompt = [
    "这是父代理拆出的一个局部子任务，请在干净上下文中完成，并只返回必要摘要或结果。",
    "## 子任务请求",
    taskPrompt,
  ].join("\n\n");

  const subagentId = `subagent-${matchedAgent.id}-${Date.now()}`;
  const innerParts: AgentPart[] = [];
  const subagentTools = buildAiSdkTools(workspaceTools, enabledToolIds, abortSignal);

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
          summary: "正在思考",
          detail: part.text,
        };
        break;
      case "tool-call":
        mappedPart = {
          type: "tool-call",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          status: "running",
          inputSummary: JSON.stringify(part.input),
        };
        break;
      case "tool-result":
        mappedPart = {
          type: "tool-result",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
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

  return { agent: matchedAgent, text: finalText, subagentId };
}

/** 把 workspace 工具转成 AI SDK ToolSet 格式 */
function buildAiSdkTools(
  workspaceTools: Record<string, AgentTool>,
  enabledToolIds: string[],
  abortSignal?: AbortSignal,
): ToolSet {
  const toolSet: ToolSet = {};
  type ToolBuilder = (tool: AgentTool) => ToolSet[string];
  const builders: Record<string, ToolBuilder> = {
    create_file: (tool) =>
      defineTool({
        description: "在指定目录创建新的文本文件。适合新增文件；如果目标文件已经存在或你只是想修改旧文件内容，不要用它。",
        inputSchema: z.object({
          parentPath: z.string().describe("新文件所在的父目录路径，必须位于工作区内。"),
          name: z.string().describe("要创建的文件名，通常应包含扩展名，如 chapter-01.md。"),
        }),
        execute: async (input: { parentPath: string; name: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input));
          return result.summary;
        },
      }),
    create_folder: (tool) =>
      defineTool({
        description: "在指定目录创建文件夹。适合补齐目录结构，不负责创建文件内容。",
        inputSchema: z.object({
          parentPath: z.string().describe("新文件夹所在的父目录路径，必须位于工作区内。"),
          name: z.string().describe("要创建的文件夹名称，不要传完整路径。"),
        }),
        execute: async (input: { parentPath: string; name: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input));
          return result.summary;
        },
      }),
    delete_path: (tool) =>
      defineTool({
        description: "删除指定文件或目录。只有在你已经确认目标路径和影响范围时才使用，避免把它当清理未知内容的通用手段。",
        inputSchema: z.object({
          path: z.string().describe("工作区内要删除的准确路径。删除目录会递归影响其下内容。"),
        }),
        execute: async (input: { path: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input));
          return result.summary;
        },
      }),
    line_edit: (tool) =>
      defineTool({
        description: "按行读取或替换文本。适合小范围精确修改；get 可读取任意正整数行号，超出文件末尾时返回空行。replace 会替换指定行，必要时自动补空行；为避免改错位置，替换前应传入前一行和后一行做校验。",
        inputSchema: z.object({
          action: z.enum(["get", "replace"]).describe("get 读取单行内容；replace 仅替换这一行，不会跨行编辑。"),
          contents: z.string().optional().describe("仅在 action=replace 时传入。必须是单行文本，不能包含换行符，也不应附带行号。"),
          lineNumber: z.number().int().positive().describe("从 1 开始的目标行号。get 支持任意正整数；replace 超出文件末尾时会自动补空行到目标位置。"),
          nextLine: z.string().optional().describe("仅在 action=replace 时使用。目标行后一行的当前内容，用于防止行号漂移导致误改；如果后一行不存在，传空字符串。"),
          path: z.string().describe("要操作的工作区文本文件路径，必须是已经存在的文本文件。"),
          previousLine: z.string().optional().describe("仅在 action=replace 时使用。目标行前一行的当前内容，用于防止行号漂移导致误改；如果前一行不存在，传空字符串。"),
        }),
        execute: async (input: {
          action: "get" | "replace";
          contents?: string;
          lineNumber: number;
          nextLine?: string;
          path: string;
          previousLine?: string;
        }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input as unknown as Record<string, unknown>));
          return result.data ?? result.summary;
        },
      }),
    list_agents: (tool) =>
      defineTool({
        description:
          "读取当前本地可用 agents 列表，返回 agent 的基础信息和可读取文件列表。通常在你还不确定 agentId 时先调用它。",
        inputSchema: z.object({}),
        execute: async (_input: Record<string, never>) => {
          const result = await withAbort(abortSignal, () => tool.execute({}));
          return result.data ?? result.summary;
        },
      }),
    todo: (tool) =>
      defineTool({
        description:
          "更新当前会话里的短计划。适合把正在做的几步显式写出来，并保持同一时间最多一个 in_progress。",
        inputSchema: z.object({
          items: z.array(
            z.object({
              content: z.string().min(1).describe("这一步要做什么。"),
              status: z.enum(["pending", "in_progress", "completed"]).default("pending"),
              activeForm: z.string().optional().describe("当步骤进行中时更自然的进行时描述。"),
            }),
          ).describe("当前整份计划。允许整份重写；同一时间最多一个 in_progress。"),
        }),
        execute: async (input: {
          items: Array<{
            activeForm?: string;
            content: string;
            status?: "pending" | "in_progress" | "completed";
          }>;
        }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input as unknown as Record<string, unknown>));
          return result.data ?? result.summary;
        },
      }),
    list_skills: (tool) =>
      defineTool({
        description:
          "读取当前本地可用 skills 列表，返回 skill 的基础信息和可读取文件列表。通常在你还不确定 skillId 时先调用它。",
        inputSchema: z.object({}),
        execute: async (_input: Record<string, never>) => {
          const result = await withAbort(abortSignal, () => tool.execute({}));
          return result.data ?? result.summary;
        },
      }),
    read_agent_file: (tool) =>
      defineTool({
        description:
          "读取指定 agent 内文件内容。先用 list_agents 确认 agentId，再读取 AGENTS.md、TOOLS.md 或 MEMORY.md。",
        inputSchema: z.object({
          agentId: z.string().describe("目标代理 ID。建议先通过 list_agents 获取，避免传错。"),
          relativePath: z
            .string()
            .describe("代理目录内的相对路径，例如 AGENTS.md、TOOLS.md 或 MEMORY.md。"),
        }),
        execute: async (input: { agentId: string; relativePath: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input as unknown as Record<string, unknown>));
          return result.summary;
        },
      }),
    read_file: (tool) =>
      defineTool({
        description: "读取完整文本文件内容。仅在你已经知道准确路径、并且需要查看全文上下文时使用；如果还不知道文件或目录在哪里，先用 search_workspace_content 或 read_workspace_tree 缩小范围。",
        inputSchema: z.object({
          path: z.string().describe("工作区内的准确文本文件路径。该工具不会帮你搜索路径，因此未知路径时不要直接调用。"),
        }),
        execute: async (input: { path: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input));
          return result.summary;
        },
      }),
    read_skill_file: (tool) =>
      defineTool({
        description:
          "读取指定 skill 内文件内容。先用 list_skills 确认 skillId 与可读文件，再读取如 SKILL.md 或 references/*.md。",
        inputSchema: z.object({
          skillId: z.string().describe("目标技能 ID。建议先通过 list_skills 获取，避免传错。"),
          relativePath: z
            .string()
            .describe("技能目录内的相对路径，例如 SKILL.md 或 references/xxx.md。"),
        }),
        execute: async (input: { relativePath: string; skillId: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input as unknown as Record<string, unknown>));
          return result.summary;
        },
      }),
    read_workspace_tree: (tool) =>
      defineTool({
        description: "读取当前工作区的目录树。适合先了解目录结构、入口文件和层级关系；它不会搜索文件正文。",
        inputSchema: z.object({}),
        execute: async (_input: Record<string, never>) => {
          const result = await withAbort(abortSignal, () => tool.execute({}));
          return result.data ?? result.summary;
        },
      }),
    rename: (tool) =>
      defineTool({
        description: "重命名工作区中的文件夹或文件。既支持文件夹重命名，也支持文件名重命名；只改名称，不修改文件正文。",
        inputSchema: z.object({
          path: z.string().describe("当前的准确路径，必须已经存在于工作区内；可以是文件夹，也可以是文件。"),
          nextName: z.string().describe("新的文件夹名称或文件名，只传名称本身，不要传完整路径。"),
        }),
        execute: async (input: { path: string; nextName: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input));
          return result.summary;
        },
      }),
    search_workspace_content: (tool) =>
      defineTool({
        description: "搜索工作区中的目录名、文件名和正文命中，用于定位目标、判断下一步该读哪个文件或改哪个位置。它只返回命中摘要，不返回完整文件内容。",
        inputSchema: z.object({
          limit: z.number().int().positive().max(200).optional().describe("最多返回多少条结果。默认 50，最大 200；范围越大，结果越噪。"),
          query: z.string().describe("搜索关键词，可匹配目录名、文件名和正文内容。建议传短语或关键实体，不要传整段自然语言。"),
        }),
        execute: async (input: { limit?: number; query: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input as unknown as Record<string, unknown>));
          return result.data ?? result.summary;
        },
      }),
    write_file: (tool) =>
      defineTool({
        description: "整文件覆盖写入。适用于你已经准备好文件的完整新内容时；调用后会覆盖原文件全部文本。若目标目录或文件不存在，会自动创建；如果只是小改动，优先使用 line_edit。",
        inputSchema: z.object({
          path: z.string().describe("要覆盖写入的目标文件路径。若上级目录或文件不存在，会在工作区内自动创建。"),
          contents: z.string().describe("文件的新完整内容。会整体覆盖旧内容，不是追加写入。"),
        }),
        execute: async (input: { path: string; contents: string }) => {
          const result = await withAbort(abortSignal, () => tool.execute(input));
          return result.summary;
        },
      }),
  };

  for (const toolId of enabledToolIds) {
    const workspaceTool = workspaceTools[toolId];
    const buildTool = builders[toolId];
    if (!workspaceTool || !buildTool) {
      continue;
    }
    toolSet[toolId] = buildTool(workspaceTool);
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
  planningState,
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

  const aiTools = buildAiSdkTools(workspaceTools, enabledToolIds, abortSignal);
  if (enabledToolIds.includes("task") && enabledAgents.length > 0) {
    aiTools.task = defineTool({
      description: "将局部任务交给子代理在干净上下文中执行，并返回摘要结果。可传 agentId 指定目标代理。",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("需要外包给子代理的局部任务指令。"),
        agentId: z.string().optional().describe("可选。目标子代理 ID；不传时系统会尝试自动匹配。"),
      }),
      execute: async (input: { prompt: string; agentId?: string }) => {
        const output = await runSubAgentTask({
          abortSignal,
          agentId: input.agentId,
          enabledAgents,
          enabledSkills,
          taskPrompt: input.prompt,
          providerConfig,
          streamFn: _subagentStreamFn,
          workspaceTools,
          enabledToolIds: enabledToolIds.filter((toolId) => toolId !== "task"),
          onProgress: (snapshot) => {
            progressQueue.push(snapshot);
          },
        });
        return {
          agentId: output.agent.id,
          agentName: output.agent.name,
          summary: output.text || `${output.agent.name} 子任务已完成。`,
          subagentId: output.subagentId,
        };
      },
    });
  }
  const system = buildSystemPrompt({
    defaultAgentMarkdown,
    enabledAgents,
    enabledSkills,
    enabledToolIds,
  });

  const planningIntervention = getPlanningIntervention(planningState, prompt);
  const userContent = buildUserTurnContent({
    activeFilePath,
    manualContext,
    planningIntervention,
    planningState,
    workspaceRootPath,
    prompt,
    subagentAnalysis: null,
  });

  const result = _streamFn({
    abortSignal,
    messages: buildConversationMessages(conversationHistory, userContent),
    providerConfig,
    system,
    tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
  });

  for await (const part of result.fullStream) {
    while (progressQueue.length > 0) {
      const snapshot = progressQueue.shift();
      if (snapshot) {
        yield snapshot;
      }
    }

    switch (part.type) {
      case "text-delta":
        yield { type: "text-delta", delta: part.text };
        break;

      case "reasoning-delta":
        yield {
          type: "reasoning",
          summary: "正在思考",
          detail: part.text,
        };
        break;

      case "tool-call":
        yield {
          type: "tool-call",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          status: "running",
          inputSummary: JSON.stringify(part.input),
        };
        break;

      case "tool-result":
        yield {
          type: "tool-result",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          status: "completed",
          outputSummary: typeof part.output === "string" ? part.output : JSON.stringify(part.output),
        };
        break;

      default:
        break;
    }

    while (progressQueue.length > 0) {
      const snapshot = progressQueue.shift();
      if (snapshot) {
        yield snapshot;
      }
    }
  }

  while (progressQueue.length > 0) {
    const snapshot = progressQueue.shift();
    if (snapshot) {
      yield snapshot;
    }
  }
}

export { createSystemMessage };










