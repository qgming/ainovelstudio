import { z } from "zod";
import type { ToolSet } from "ai";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { AgentMessage, AgentPart } from "./types";
import { generateAgentText, streamAgentText, defineTool } from "./modelGateway";
import type { AgentTool } from "./runtime";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { selectSubAgentForPrompt } from "./delegation";
import { buildConversationMessages } from "./messageContext";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import type { ProjectContextPayload } from "./projectContext";
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
  debugLabel?: string;
  workspaceRootPath?: string | null;
  conversationHistory?: AgentMessage[];
  defaultAgentMarkdown?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  /** 启用的工具 ID 列表 */
  enabledToolIds: string[];
  includeAgentCatalog?: boolean;
  manualContext?: ManualTurnContextPayload | null;
  planningState?: PlanningState | null;
  projectContext?: ProjectContextPayload | null;
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

type DebuggableMessage = {
  content: string;
  role: string;
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
          "浏览工作区结构。支持查看目录树、列出目录内容、检查路径概况，以及对 list 结果做筛选、排序和限量。",
        inputSchema: z.object({
          depth: z
            .number()
            .int()
            .positive()
            .max(8)
            .optional()
            .describe("仅在 mode=tree 时使用。限制返回的树深度，默认 2。"),
          extensions: z
            .array(z.string())
            .optional()
            .describe("仅在 mode=list 时使用。按文件扩展名过滤，如 ['md', '.json']。"),
          kind: z
            .enum(["all", "directory", "file"])
            .default("all")
            .describe("仅在 mode=list 时使用。筛选目录、文件或全部。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(200)
            .optional()
            .describe("仅在 mode=list 时使用。限制返回的子项数量。"),
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
          sortBy: z
            .enum(["name", "type"])
            .default("name")
            .describe("仅在 mode=list 时使用。name 按名称排序，type 先目录后文件。"),
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
          "搜索目录名、文件名和正文内容，支持大小写、整词、排序和上下文窗口，用于更精准地定位目标。",
        inputSchema: z.object({
          afterLines: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅对正文命中生效。返回命中行之后的上下文行数。"),
          beforeLines: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅对正文命中生效。返回命中行之前的上下文行数。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("为 true 时启用大小写敏感匹配。默认 false。"),
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
          matchMode: z
            .enum(["phrase", "all_terms", "any_term"])
            .default("phrase")
            .describe("phrase 按完整短语匹配；all_terms 要求所有词都命中；any_term 允许任一词命中。"),
          maxPerFile: z
            .number()
            .int()
            .positive()
            .max(20)
            .optional()
            .describe("每个文件最多保留多少条结果。"),
          path: z
            .string()
            .optional()
            .describe("可选，相对工作区路径，只在该路径下过滤结果。"),
          query: z
            .string()
            .describe("搜索关键词，建议传短语、章节名、角色名或字段名。"),
          sortBy: z
            .enum(["path", "relevance"])
            .default("relevance")
            .describe("结果排序方式。relevance 更偏重命中质量，path 按路径排序。"),
          scope: z
            .enum(["all", "content", "names"])
            .default("all")
            .describe(
              "all 搜目录名+文件名+正文，content 只搜正文，names 只搜目录名和文件名。",
            ),
          wholeWord: z
            .boolean()
            .optional()
            .describe("为 true 时优先匹配整词边界，适合英文名词或标识符。"),
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
    web_search: (toolName, tool) =>
      defineTool({
        description:
          "搜索公开网络信息并返回标题、摘要和链接，支持站点过滤，适合查询外部资料、平台规则和最新公开网页内容。",
        inputSchema: z.object({
          domains: z
            .array(z.string())
            .optional()
            .describe("可选。限制结果优先来自这些站点域名，如 ['openai.com', 'platform.openai.com']。"),
          language: z
            .string()
            .optional()
            .describe("结果语言，默认 zh-CN。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(10)
            .optional()
            .describe("最多返回多少条结果，默认 5，最大 10。"),
          query: z.string().min(1).describe("搜索关键词或问题。"),
          safesearch: z
            .union([z.literal(0), z.literal(1), z.literal(2)])
            .optional()
            .describe("安全搜索等级：0 关闭，1 中等，2 严格。默认 1。"),
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
    web_fetch: (toolName, tool) =>
      defineTool({
        description:
          "读取指定网页并提取标题与主要正文，支持整页、锚点附近或标题块定向提取。",
        inputSchema: z.object({
          afterBlocks: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中块之后额外返回多少块。"),
          anchor: z
            .string()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。用于定位的正文锚点。"),
          beforeBlocks: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中块之前额外返回多少块。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。是否大小写敏感。"),
          heading: z
            .string()
            .optional()
            .describe("仅在 mode=heading_range 时使用。要提取的标题文本，可带或不带 #。"),
          includeLinks: z
            .boolean()
            .optional()
            .describe("是否额外提取正文区域内的结构化链接列表。"),
          includeTables: z
            .boolean()
            .optional()
            .describe("是否额外提取正文区域内的结构化表格。"),
          maxChars: z
            .number()
            .int()
            .positive()
            .max(20000)
            .optional()
            .describe("正文最大返回字符数，默认 8000，最大 20000。"),
          mode: z
            .enum(["full", "anchor_range", "heading_range"])
            .default("full")
            .describe("full 返回整页正文；anchor_range 返回锚点附近块；heading_range 返回指定标题块。"),
          occurrence: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("在 anchor_range 或 heading_range 中使用第几次命中，默认 1。"),
          url: z.string().url().describe("要读取的完整网页地址。"),
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
          "读取文本文件。已知准确路径时使用；支持全文、头尾、行段、锚点范围和 Markdown 标题范围。",
        inputSchema: z.object({
          afterLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中行之后额外返回多少行。"),
          anchor: z
            .string()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。用于定位的锚点文本。"),
          beforeLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中行之前额外返回多少行。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。是否大小写敏感。"),
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 mode=range 时使用。结束行号，包含该行。"),
          heading: z
            .string()
            .optional()
            .describe("仅在 mode=heading_range 时使用。Markdown 标题文本，可带或不带 #。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(400)
            .optional()
            .describe("在 head 或 tail 模式下返回的最大行数，默认 80。"),
          mode: z
            .enum([
              "anchor_range",
              "full",
              "head",
              "heading_range",
              "range",
              "tail",
            ])
            .default("full")
            .describe(
              "full 返回全文；head / tail 返回头尾片段；range 返回指定行段；anchor_range 返回锚点附近内容；heading_range 返回 Markdown 标题块。",
            ),
          occurrence: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("在 anchor_range 或 heading_range 中使用第几次命中，默认 1。"),
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
    word_count: (toolName, tool) =>
      defineTool({
        description:
          "统计指定文本文件的字符数、非空白字符数、中文字符数、英文单词数、数字数、行数和段落数。",
        inputSchema: z.object({
          path: z
            .string()
            .describe("目标文本文件的相对工作区路径。"),
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
          "对文本做局部编辑。支持精确锚点替换，以及按行段整体替换，不需要整份重写。",
        inputSchema: z.object({
          action: z
            .enum([
              "append",
              "insert_after",
              "insert_before",
              "prepend",
              "replace_anchor_range",
              "replace_heading_range",
              "replace_lines",
              "replace",
            ])
            .default("replace"),
          afterLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。命中行之后额外覆盖多少行。"),
          anchor: z
            .string()
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。用于定位的锚点文本。"),
          beforeLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。命中行之前额外覆盖多少行。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。是否大小写敏感。"),
          content: z.string().describe("要写入的新文本。"),
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=replace_lines 时使用。结束行号，包含该行。"),
          expectedCount: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("replaceAll=false 时，预期 target 命中的次数，默认 1。"),
          heading: z
            .string()
            .optional()
            .describe("仅在 action=replace_heading_range 时使用。Markdown 标题文本，可带或不带 #。"),
          occurrence: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("在 replace_anchor_range 或 replace_heading_range 中使用第几次命中，默认 1。"),
          path: z.string().describe("目标文本文件的相对工作区路径。"),
          replaceAll: z
            .boolean()
            .optional()
            .describe("为 true 时，对所有命中的 target 生效。"),
          startLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=replace_lines 时使用。起始行号，从 1 开始。"),
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
          "读取或局部更新 JSON。优先用它改字段、对象和数组；支持模板补齐、历史追加和 patch；多步变更优先 action=batch 或 patch，一次写回。",
        inputSchema: z.object({
          action: z
            .enum([
              "append",
              "batch",
              "delete",
              "ensure_template",
              "get",
              "history_append",
              "merge",
              "patch",
              "set",
            ])
            .default("get"),
          patch: z
            .array(
              z.object({
                from: z
                  .string()
                  .optional()
                  .describe("copy / move 时来源 JSON Pointer。"),
                op: z
                  .enum(["add", "copy", "move", "remove", "replace", "test"])
                  .describe("RFC 6902 风格的 patch 动作。"),
                path: z.string().describe("patch 目标 JSON Pointer。"),
                value: z.unknown().optional().describe("add / replace / test 时使用的值。"),
              }),
            )
            .optional()
            .describe("仅在 action=patch 时使用。按顺序执行的 JSON Patch 操作。"),
          operations: z
            .array(
              z.object({
                action: z
                  .enum(["append", "delete", "merge", "set"])
                  .describe("batch 中的单步动作。"),
                pointer: z
                  .string()
                  .optional()
                  .describe(
                    "batch 中该步操作的 JSON Pointer。空字符串表示根节点。",
                  ),
                value: z
                  .unknown()
                  .optional()
                  .describe("append / merge / set 时要写入的新值。"),
              }),
            )
            .optional()
            .describe("仅在 action=batch 时使用。按顺序依次执行的操作列表。"),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=history_append 时使用。限制历史数组最大保留条数。"),
          path: z.string().describe("目标 JSON 文件的相对工作区路径。"),
          pointer: z
            .string()
            .optional()
            .describe(
              "JSON Pointer。空字符串表示根节点，例如 /stage、/chapters/0/title。",
            ),
          timestamp: z
            .string()
            .optional()
            .describe("仅在 action=history_append 时使用。手动指定写入时间。"),
          timestampField: z
            .string()
            .optional()
            .describe("仅在 action=history_append 时使用。记录时间字段名，默认 updatedAt。"),
          value: z
            .unknown()
            .optional()
            .describe("set / merge / append / ensure_template / history_append 时需要的新值。"),
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
              "read / write 时 agent 内的相对路径，如 manifest.json 或 AGENTS.md。",
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
    workflow_decision: (toolName, tool) =>
      defineTool({
        description:
          "向当前工作流判断节点提交最终结构化判定。程序只会依据这个工具结果决定通过或失败分支。",
        inputSchema: z.object({
          pass: z.boolean().describe("true 表示通过，false 表示存在问题。"),
          reason: z.string().min(1).describe("本次判断结论的结构化原因。"),
          issues: z
            .array(
              z.object({
                type: z.string().min(1).describe("问题类型，如 continuity、logic。"),
                severity: z
                  .enum(["low", "medium", "high"])
                  .describe("问题严重级别。"),
                message: z.string().min(1).describe("具体问题说明。"),
              }),
            )
            .describe("结构化问题列表，可为空数组。"),
          revision_brief: z
            .string()
            .describe("给下一步章节修订直接使用的简明修改摘要，可为空字符串。"),
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

function normalizeDebugMessageContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function logPromptDebug(params: {
  label: string;
  messages: DebuggableMessage[];
  system: string;
}) {
  const { label, messages, system } = params;
  const header = `[Prompt Debug] ${label}`;
  const groupLabel = typeof console.groupCollapsed === "function"
    ? console.groupCollapsed
    : console.log;
  const groupEnd = typeof console.groupEnd === "function"
    ? console.groupEnd
    : null;

  groupLabel(header);
  console.log("System Prompt:");
  console.log(system);
  messages.forEach((message, index) => {
    console.log(`Message ${index + 1} [${message.role}]:`);
    console.log(message.content);
  });
  groupEnd?.();
}

/**
 * 运行一轮 agent 对话，以 async generator 形式逐步 yield AgentPart。
 * 调用方可实时消费每个 part 更新 UI。
 */
export async function* runAgentTurn({
  abortSignal,
  activeFilePath,
  debugLabel,
  workspaceRootPath,
  conversationHistory = [],
  defaultAgentMarkdown,
  enabledAgents,
  enabledSkills,
  enabledToolIds,
  includeAgentCatalog = true,
  manualContext,
  planningState,
  projectContext,
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
    includeAgentCatalog,
  });

  const planningIntervention = getPlanningIntervention(planningState, prompt);
  const userContent = buildUserTurnContent({
    activeFilePath,
    manualContext,
    planningIntervention,
    planningState,
    projectContext,
    workspaceRootPath,
    prompt,
    subagentAnalysis: null,
  });
  const messages = await buildConversationMessages(conversationHistory, userContent, {
    summarizeHistory: async ({ currentUserContent, taskMemory }) => {
      const memoryLines = [
        taskMemory.userGoals.length > 0
          ? `当前目标：${taskMemory.userGoals.join(" | ")}`
          : null,
        taskMemory.progress.length > 0
          ? `已有进展：${taskMemory.progress.join(" | ")}`
          : null,
        taskMemory.facts.length > 0
          ? `已确认事实：${taskMemory.facts.join(" | ")}`
          : null,
        taskMemory.constraints.length > 0
          ? `当前约束：${taskMemory.constraints.join(" | ")}`
          : null,
        taskMemory.paths.length > 0
          ? `相关路径：${taskMemory.paths.join(" | ")}`
          : null,
        taskMemory.tools.length > 0
          ? `已用工具：${taskMemory.tools.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      return generateAgentText({
        prompt: [
          "请把下面的会话任务记忆压缩成一段高密度摘要。",
          "输出要求：",
          "- 只保留继续当前任务真正需要的信息",
          "- 优先保留目标、已确认事实、约束、相关文件和下一步",
          "- 不要复述无关寒暄，不要写解释，不要分段标题",
          "- 使用简体中文，控制在 180 字以内",
          "",
          `当前用户请求：${currentUserContent}`,
          "",
          memoryLines,
        ].join("\n"),
        providerConfig,
        system: "你是任务记忆压缩器。只输出一段精炼摘要，不输出标题，不输出多余说明。",
      });
    },
  });

  logPromptDebug({
    label: debugLabel ?? "chat-turn",
    messages: messages.map((message) => ({
      content: normalizeDebugMessageContent(message.content),
      role: message.role,
    })),
    system,
  });

  const result = _streamFn({
    abortSignal,
    messages,
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
