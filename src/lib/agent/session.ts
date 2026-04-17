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
import {
  buildSubAgentSystem,
  buildSystemPrompt,
  buildUserTurnContent,
} from "./promptContext";
import { getPlanningIntervention, type PlanningState } from "./planning";
import { createToolResultPart, mergeToolResultPart } from "./toolParts";
import type { AgentUsage } from "./types";

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
  onToolRequestStateChange?: (event: {
    requestId: string;
    status: "start" | "finish";
  }) => void;
  onUsage?: (usage: AgentUsage) => void;
  /** 可选：用于测试注入的流式调用 */
  _streamFn?: typeof streamAgentText;
  /** 可选：用于测试注入的子代理流式调用 */
  _subagentStreamFn?: typeof streamAgentText;
};

function hasProviderConfig(config: AgentProviderConfig) {
  return Boolean(
    config.apiKey.trim() && config.baseURL.trim() && config.model.trim(),
  );
}

function createAbortError() {
  return new DOMException("Agent execution aborted.", "AbortError");
}

function createToolRequestId(toolName: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `tool-${toolName}-${crypto.randomUUID()}`;
  }

  return `tool-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function throwIfAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }
}

async function withAbort<T>(
  abortSignal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
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

function mergeSubagentInnerParts(
  parts: AgentPart[],
  part: AgentPart,
): AgentPart[] {
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
      return [
        ...parts.slice(0, -1),
        { ...last, detail: last.detail + part.detail },
      ];
    }
    return [...parts, part];
  }

  if (part.type === "tool-result") {
    return mergeToolResultPart(parts, part);
  }

  return [...parts, part];
}

export async function runSubAgentTask(params: {
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
  const {
    abortSignal,
    agentId,
    enabledAgents,
    enabledSkills,
    taskPrompt,
    providerConfig,
    streamFn,
    workspaceTools,
    enabledToolIds,
    onProgress,
  } = params;
  const explicitAgent = agentId
    ? (enabledAgents.find((agent) => agent.id === agentId) ?? null)
    : null;
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
  const subagentTools = buildAiSdkTools(
    workspaceTools,
    enabledToolIds,
    abortSignal,
    undefined,
  );

  throwIfAborted(abortSignal);
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
    throwIfAborted(abortSignal);
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
        mappedPart = createToolResultPart({
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          output: part.output,
        });
        break;
      default:
        break;
    }

    if (!mappedPart) {
      continue;
    }

    const mergedParts = mergeSubagentInnerParts(innerParts, mappedPart);
    innerParts.splice(0, innerParts.length, ...mergedParts);
    throwIfAborted(abortSignal);
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
    .filter(
      (part): part is Extract<AgentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");

  throwIfAborted(abortSignal);
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
  onToolRequestStateChange?: (event: {
    requestId: string;
    status: "start" | "finish";
  }) => void,
): ToolSet {
  const toolSet: ToolSet = {};
  type ToolBuilder = (toolName: string, tool: AgentTool) => ToolSet[string];
  const runTool = async (
    toolName: string,
    tool: AgentTool,
    input: Record<string, unknown>,
  ) => {
    const requestId = createToolRequestId(toolName);
    onToolRequestStateChange?.({ requestId, status: "start" });
    try {
      return await withAbort(abortSignal, () =>
        tool.execute(input, { abortSignal, requestId }),
      );
    } finally {
      onToolRequestStateChange?.({ requestId, status: "finish" });
    }
  };
  const builders: Record<string, ToolBuilder> = {
    todo: (toolName, tool) =>
      defineTool({
        description:
          "更新当前会话里的短计划，并保持同一时间最多一个 in_progress。",
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                activeForm: z
                  .string()
                  .optional()
                  .describe("当步骤处于进行中时，更自然的进行时描述。"),
                content: z.string().min(1).describe("这一步要做什么。"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .default("pending"),
              }),
            )
            .describe("当前整份计划。允许整份重写。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    browse: (toolName, tool) =>
      defineTool({
        description:
          "浏览工作区结构。适合先看目录树、列出目录内容，或检查某个路径的概况。",
        inputSchema: z.object({
          depth: z
            .number()
            .int()
            .positive()
            .max(8)
            .optional()
            .describe("仅在 mode=tree 时使用。限制返回的树深度，默认 2。"),
          mode: z
            .enum(["list", "stat", "tree"])
            .default("list")
            .describe(
              "list 列出目录直接子项；stat 查看路径概况；tree 返回裁剪后的目录树。",
            ),
          path: z
            .string()
            .optional()
            .describe("要浏览的相对工作区路径；不传时默认为工作区根目录。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    search: (toolName, tool) =>
      defineTool({
        description:
          "搜索目录名、文件名和正文内容，用于先定位目标，再决定是否 read 或 edit。",
        inputSchema: z.object({
          extensions: z
            .array(z.string())
            .optional()
            .describe("可选的扩展名过滤，如 ['md', '.json']。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(200)
            .optional()
            .describe("最多返回多少条结果。默认 50。"),
          path: z
            .string()
            .optional()
            .describe("可选，相对工作区路径，只在该路径下过滤结果。"),
          query: z
            .string()
            .describe("搜索关键词，建议传短语、章节名、角色名或字段名。"),
          scope: z
            .enum(["all", "content", "names"])
            .default("all")
            .describe(
              "all 搜目录名+文件名+正文，content 只搜正文，names 只搜目录名和文件名。",
            ),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    read: (toolName, tool) =>
      defineTool({
        description:
          "读取文本文件。已知准确路径时使用；支持全文、头部、尾部或指定行段。",
        inputSchema: z.object({
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 mode=range 时使用。结束行号，包含该行。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(400)
            .optional()
            .describe("在 head 或 tail 模式下返回的最大行数，默认 80。"),
          mode: z
            .enum(["full", "head", "range", "tail"])
            .default("full")
            .describe(
              "full 返回全文；head / tail 返回头尾片段；range 返回指定行段。",
            ),
          path: z.string().describe("目标文本文件的相对工作区路径。"),
          startLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 mode=range 时使用。起始行号，从 1 开始。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    edit: (toolName, tool) =>
      defineTool({
        description:
          "对文本做局部编辑。适合替换、前插、后插、追加或前置，不需要整份重写。",
        inputSchema: z.object({
          action: z
            .enum([
              "append",
              "insert_after",
              "insert_before",
              "prepend",
              "replace",
            ])
            .default("replace"),
          content: z.string().describe("要写入的新文本。"),
          expectedCount: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("replaceAll=false 时，预期 target 命中的次数，默认 1。"),
          path: z.string().describe("目标文本文件的相对工作区路径。"),
          replaceAll: z
            .boolean()
            .optional()
            .describe("为 true 时，对所有命中的 target 生效。"),
          target: z
            .string()
            .optional()
            .describe(
              "replace / insert_before / insert_after 时需要的锚点文本。",
            ),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.summary;
        },
      }),
    write: (toolName, tool) =>
      defineTool({
        description: "整文件覆盖写入。只有在你已经准备好完整新内容时使用。",
        inputSchema: z.object({
          content: z.string().describe("文件的新完整内容。"),
          path: z.string().describe("目标文件的相对工作区路径。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.summary;
        },
      }),
    json: (toolName, tool) =>
      defineTool({
        description:
          "读取或局部更新 JSON。优先用它改字段、对象和数组，不要为了改一个键整份重写。",
        inputSchema: z.object({
          action: z
            .enum(["append", "delete", "get", "merge", "set"])
            .default("get"),
          path: z.string().describe("目标 JSON 文件的相对工作区路径。"),
          pointer: z
            .string()
            .optional()
            .describe(
              "JSON Pointer。空字符串表示根节点，例如 /stage、/chapters/0/title。",
            ),
          value: z
            .unknown()
            .optional()
            .describe("set / merge / append 时需要的新值。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    path: (toolName, tool) =>
      defineTool({
        description:
          "处理工作区中的结构性变更，如创建文件、创建文件夹、重命名、迁移和删除。",
        inputSchema: z.object({
          action: z
            .enum(["create_file", "create_folder", "delete", "move", "rename"])
            .describe("要执行的路径动作。"),
          name: z
            .string()
            .optional()
            .describe("create_file / create_folder / rename 时需要的名称。"),
          parentPath: z
            .string()
            .optional()
            .describe("create_file / create_folder 时使用的父目录路径。"),
          path: z
            .string()
            .optional()
            .describe("rename / move / delete 时的目标路径。"),
          targetParentPath: z
            .string()
            .optional()
            .describe("move 时的目标父目录路径。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.summary;
        },
      }),
    skill: (toolName, tool) =>
      defineTool({
        description:
          "读取或管理本地 skill。先 list，再 read / write 具体文件。",
        inputSchema: z.object({
          action: z
            .enum([
              "create",
              "create_reference",
              "delete",
              "list",
              "read",
              "write",
            ])
            .default("list"),
          content: z
            .string()
            .optional()
            .describe("write 时要写入 skill 文件的新内容。"),
          description: z
            .string()
            .optional()
            .describe("create 时的新 skill 简介。"),
          name: z
            .string()
            .optional()
            .describe(
              "create 时的新 skill 名称；create_reference 时的新参考文件名称。",
            ),
          relativePath: z
            .string()
            .optional()
            .describe(
              "read / write 时 skill 内的相对路径，如 SKILL.md 或 references/voice.md。",
            ),
          skillId: z
            .string()
            .optional()
            .describe("list 之外的动作通常都需要 skillId。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    agent: (toolName, tool) =>
      defineTool({
        description:
          "读取或管理本地 agent。先 list，再 read / write 具体文件。",
        inputSchema: z.object({
          action: z
            .enum(["create", "delete", "list", "read", "write"])
            .default("list"),
          agentId: z
            .string()
            .optional()
            .describe("list 之外的动作通常都需要 agentId。"),
          content: z
            .string()
            .optional()
            .describe("write 时要写入 agent 文件的新内容。"),
          description: z
            .string()
            .optional()
            .describe("create 时的新 agent 简介。"),
          name: z.string().optional().describe("create 时的新 agent 名称。"),
          relativePath: z
            .string()
            .optional()
            .describe(
              "read / write 时 agent 内的相对路径，如 manifest.json、AGENTS.md、TOOLS.md 或 MEMORY.md。",
            ),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
  };

  for (const toolId of enabledToolIds) {
    const workspaceTool = workspaceTools[toolId];
    const buildTool = builders[toolId];
    if (!workspaceTool || !buildTool) {
      continue;
    }
    toolSet[toolId] = buildTool(toolId, workspaceTool);
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
  onToolRequestStateChange,
  onUsage,
  _streamFn = streamAgentText,
  _subagentStreamFn = streamAgentText,
}: RunAgentTurnInput): AsyncGenerator<AgentPart> {
  const progressQueue: AgentPart[] = [];
  if (!hasProviderConfig(providerConfig)) {
    yield {
      type: "text",
      text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。",
    };
    return;
  }

  const aiTools = buildAiSdkTools(
    workspaceTools,
    enabledToolIds,
    abortSignal,
    onToolRequestStateChange,
  );
  if (enabledToolIds.includes("task") && enabledAgents.length > 0) {
    aiTools.task = defineTool({
      description:
        "将局部任务交给子代理在干净上下文中执行，并返回摘要结果。可传 agentId 指定目标代理。",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("需要外包给子代理的局部任务指令。"),
        agentId: z
          .string()
          .optional()
          .describe("可选。目标子代理 ID；不传时系统会尝试自动匹配。"),
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

  throwIfAborted(abortSignal);
  for await (const part of result.fullStream) {
    throwIfAborted(abortSignal);
    while (progressQueue.length > 0) {
      throwIfAborted(abortSignal);
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
        yield createToolResultPart({
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          output: part.output,
        });
        break;

      default:
        break;
    }

    while (progressQueue.length > 0) {
      throwIfAborted(abortSignal);
      const snapshot = progressQueue.shift();
      if (snapshot) {
        yield snapshot;
      }
    }
  }

  while (progressQueue.length > 0) {
    throwIfAborted(abortSignal);
    const snapshot = progressQueue.shift();
    if (snapshot) {
      yield snapshot;
    }
  }

  throwIfAborted(abortSignal);
  const usage = await result.usagePromise;
  if (usage) {
    onUsage?.(usage);
  }
}

export { createSystemMessage };
