/**
 * Agent 主回合（runAgentTurn）：组装 system prompt + 工具集，调用模型并以 async generator
 * 形式逐步 yield 流式 part，调用方据此实时刷新 UI。
 *
 * 历史上 session.ts 还承载子任务执行、buildAiSdkTools、调试日志、abort 工具等，已分别拆到：
 *   - asyncUtils.ts
 *   - subagentParts.ts
 *   - debug.ts
 *   - buildAiSdkTools.ts
 *   - runSubAgentTask.ts
 * 本文件只保留主回合协调逻辑。
 */

import { z } from "zod";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { AgentTool } from "./runtime";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import type { ProjectContextPayload } from "./projectContext";
import type { AgentMode, ModeContextMap } from "./modeRules";
import type { PlanningState } from "./planning";
import type {
  AgentMessage,
  AgentPart,
  AgentUsage,
  AskToolAnswer,
  AskUserRequest,
} from "./types";
import { generateAgentText, streamAgentText, defineTool } from "./modelGateway";
import { buildConversationMessages } from "./messageContext";
import {
  buildSystemPrompt,
  buildUserTurnContent,
} from "./promptContext";
import { getPlanningIntervention } from "./planning";
import { createToolResultPart } from "./toolParts";
import { throwIfAborted, withAbort } from "./asyncUtils";
import { logPromptDebug, normalizeDebugMessageContent, createSystemMessage } from "./debug";
import { buildAiSdkTools } from "./buildAiSdkTools";
import { runSubAgentTask, type TemporarySubAgentProfile } from "./runSubAgentTask";

const MAX_TASK_BATCH_SIZE = 8;
const DEFAULT_TASK_BATCH_CONCURRENCY = 2;
const MAX_TASK_BATCH_CONCURRENCY = 4;

type TaskToolItemInput = {
  id?: string;
  prompt: string;
  agentName?: string;
  role?: string;
  instructions?: string;
};

type TaskToolInput = {
  prompt?: string;
  agentName?: string;
  role?: string;
  instructions?: string;
  tasks?: TaskToolItemInput[];
  concurrency?: number;
  sharedContext?: string;
};

type NormalizedTaskRequest = {
  id: string;
  prompt: string;
  temporaryAgent?: TemporarySubAgentProfile;
};

type TaskExecutionResult = {
  id: string;
  status: "completed" | "failed";
  summary: string;
  agentName?: string;
  subagentId?: string;
  error?: string;
};

const taskItemInputSchema = z.object({
  id: z.string().optional().describe("可选。批量任务里的稳定 ID，便于结果回填。"),
  prompt: z.string().min(1).describe("需要外包给子代理的局部任务指令。"),
  agentName: z.string().optional().describe("可选。临时 subagent 名称。"),
  role: z.string().optional().describe("可选。临时 subagent 的专业角色。"),
  instructions: z.string().optional().describe("可选。临时 subagent 的执行约束或专长说明。"),
});

const taskToolInputSchema = z
	  .object({
	    prompt: z.string().min(1).optional().describe("单个子任务指令。"),
	    agentName: z.string().optional().describe("单任务临时 subagent 名称。"),
    role: z.string().optional().describe("单任务临时 subagent 角色。"),
    instructions: z.string().optional().describe("单任务临时 subagent 执行说明。"),
    tasks: z
      .array(taskItemInputSchema)
      .min(1)
      .max(MAX_TASK_BATCH_SIZE)
      .optional()
      .describe("批量子任务，最多 8 个，仅用于彼此独立的工作。"),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(MAX_TASK_BATCH_CONCURRENCY)
      .optional()
      .describe("批量并发数，默认 2，最大 4。"),
    sharedContext: z
      .string()
      .min(1)
      .optional()
      .describe(
        "所有子任务共享的前缀（章节摘要、人物清单、世界观片段等），避免每个 prompt 重复塞。",
      ),
  })
  .refine((input) => Boolean(input.prompt || input.tasks?.length), {
    message: "必须提供 prompt 或 tasks。",
  });

export type RunAgentTurnInput = {
  abortSignal?: AbortSignal;
  activeFilePath: string | null;
  debugLabel?: string;
  workspaceRootPath?: string | null;
  conversationHistory?: AgentMessage[];
  defaultAgentMarkdown?: string;
  enabledSkills: ResolvedSkill[];
  /** 启用的工具 ID 列表 */
  enabledToolIds: string[];
  mode?: AgentMode;
  modeContext?: ModeContextMap[AgentMode];
  manualContext?: ManualTurnContextPayload | null;
  planningState?: PlanningState | null;
  projectContext?: ProjectContextPayload | null;
  prompt: string;
  providerConfig: AgentProviderConfig;
  /** workspace 工具集 */
  workspaceTools: Record<string, AgentTool>;
  onAskUser?: (event: {
    request: AskUserRequest;
    toolCallId: string;
  }) => Promise<AskToolAnswer>;
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

function hasProviderConfig(config: AgentProviderConfig): boolean {
  return Boolean(
    config.apiKey.trim() && config.baseURL.trim() && config.model.trim(),
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function normalizeTaskToolInput(input: TaskToolInput) {
  const requests = input.tasks?.length
      ? input.tasks.map((task, index) => ({
          id: task.id?.trim() || `task-${index + 1}`,
          prompt: task.prompt,
          temporaryAgent: buildTemporaryAgentProfile(task),
        }))
    : [
        {
          id: "task-1",
          prompt: input.prompt ?? "",
          temporaryAgent: buildTemporaryAgentProfile(input),
        },
      ];
  const concurrency = input.tasks?.length
    ? input.concurrency ?? DEFAULT_TASK_BATCH_CONCURRENCY
    : 1;
  const sharedContext = input.sharedContext?.trim() || undefined;

  return {
    concurrency: Math.min(concurrency, MAX_TASK_BATCH_CONCURRENCY, requests.length),
    isBatch: Boolean(input.tasks?.length),
    requests,
    sharedContext,
  };
}

function buildTemporaryAgentProfile(input: {
  agentName?: string;
  instructions?: string;
  role?: string;
}): TemporarySubAgentProfile | undefined {
  const name = input.agentName?.trim();
  const role = input.role?.trim();
  const instructions = input.instructions?.trim();
  if (!name && !role && !instructions) {
    return undefined;
  }
  return {
    body: instructions,
    description: instructions,
    name,
    role,
  };
}

function buildSubAgentPromptWithContext(prompt: string, sharedContext?: string) {
  if (!sharedContext) {
    return prompt;
  }
  return ["## 共享上下文", sharedContext, "", "## 当前子任务", prompt].join("\n");
}

async function runTaskBatch(
  requests: NormalizedTaskRequest[],
  concurrency: number,
  runOne: (request: NormalizedTaskRequest) => Promise<TaskExecutionResult>,
) {
  const results: TaskExecutionResult[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, requests.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < requests.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await runOne(requests[currentIndex]);
      }
    }),
  );

  return results;
}

function buildTaskBatchOutput(results: TaskExecutionResult[]) {
  const completed = results.filter((result) => result.status === "completed").length;
  return {
    mode: "batch",
    total: results.length,
    completed,
    failed: results.length - completed,
    results,
  };
}

async function runTaskRequest({
	  abortSignal,
	  enabledSkills,
  enabledToolIds,
  onProgress,
  providerConfig,
  request,
  streamFn,
  workspaceTools,
}: {
  abortSignal?: AbortSignal;
	  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  onProgress: (snapshot: AgentPart & { type: "subagent" }) => void;
  providerConfig: AgentProviderConfig;
  request: NormalizedTaskRequest;
  streamFn: typeof streamAgentText;
  workspaceTools: Record<string, AgentTool>;
}): Promise<TaskExecutionResult> {
  try {
	    const output = await runSubAgentTask({
	      abortSignal,
	      temporaryAgent: request.temporaryAgent,
	      enabledSkills,
      taskPrompt: request.prompt,
      providerConfig,
      streamFn,
      workspaceTools,
      enabledToolIds: enabledToolIds.filter((toolId) => toolId !== "task"),
      onProgress,
    });
    return {
	      id: request.id,
	      status: "completed",
	      agentName: output.agent.name,
      summary: output.text || `${output.agent.name} 子任务已完成。`,
      subagentId: output.subagentId,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return {
      id: request.id,
      status: "failed",
      summary: getErrorMessage(error, "子任务执行失败。"),
      error: getErrorMessage(error, "子任务执行失败。"),
    };
  }
}

function createPartQueue() {
  const items: AgentPart[] = [];
  let done = false;
  let pendingError: unknown;
  let waiter: (() => void) | null = null;

  return {
    close(error?: unknown) {
      done = true;
      pendingError = error;
      waiter?.();
      waiter = null;
    },
    push(part: AgentPart) {
      items.push(part);
      waiter?.();
      waiter = null;
    },
    async *stream(): AsyncGenerator<AgentPart> {
      while (true) {
        while (items.length > 0) {
          const next = items.shift();
          if (next) {
            yield next;
          }
        }

        if (done) {
          if (pendingError) {
            throw pendingError;
          }
          return;
        }

        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
    },
  };
}

function createScopedAskUser(params: {
  abortSignal?: AbortSignal;
  enqueuePart: (part: AgentPart) => void;
  onAskUser?: RunAgentTurnInput["onAskUser"];
}) {
  const { abortSignal, enqueuePart, onAskUser } = params;
  let pendingToolCallId: string | null = null;

  return async function askUser(
    toolCallId: string | undefined,
    request: AskUserRequest,
  ): Promise<AskToolAnswer> {
    if (!toolCallId?.trim()) {
      throw new Error("ask 工具缺少 toolCallId，无法建立交互。");
    }
    if (!onAskUser) {
      throw new Error("当前运行环境不支持 ask 交互。");
    }
    if (pendingToolCallId && pendingToolCallId !== toolCallId) {
      throw new Error("当前已有等待用户回答的 ask，暂不支持并发交互。");
    }

    pendingToolCallId = toolCallId;
    enqueuePart({
      type: "ask-user",
      toolName: "ask",
      toolCallId,
      status: "awaiting_user",
      title: request.title,
      description: request.description,
      selectionMode: request.selectionMode,
      options: request.options,
      customOptionId: request.customOptionId,
      customPlaceholder: request.customPlaceholder,
      minSelections: request.minSelections,
      maxSelections: request.maxSelections,
      confirmLabel: request.confirmLabel,
    });

    try {
      const answer = await withAbort(abortSignal, () =>
        onAskUser({ request, toolCallId }),
      );
      enqueuePart({
        type: "ask-user",
        toolName: "ask",
        toolCallId,
        status: "completed",
        title: request.title,
        description: request.description,
        selectionMode: request.selectionMode,
        options: request.options,
        customOptionId: request.customOptionId,
        customPlaceholder: request.customPlaceholder,
        minSelections: request.minSelections,
        maxSelections: request.maxSelections,
        confirmLabel: request.confirmLabel,
        answer,
      });
      return answer;
    } catch (error) {
      enqueuePart({
        type: "ask-user",
        toolName: "ask",
        toolCallId,
        status: "failed",
        title: request.title,
        description: request.description,
        selectionMode: request.selectionMode,
        options: request.options,
        customOptionId: request.customOptionId,
        customPlaceholder: request.customPlaceholder,
        minSelections: request.minSelections,
        maxSelections: request.maxSelections,
        confirmLabel: request.confirmLabel,
        errorMessage: isAbortError(error)
          ? "等待用户输入的交互已中断，请重新发起。"
          : getErrorMessage(error, "等待用户输入时发生未知错误。"),
      });
      throw error;
    } finally {
      if (pendingToolCallId === toolCallId) {
        pendingToolCallId = null;
      }
    }
  };
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
	  enabledSkills,
	  enabledToolIds,
	  mode,
  modeContext,
  manualContext,
  planningState,
  projectContext,
  prompt,
  providerConfig,
  workspaceTools,
  onAskUser,
  onToolRequestStateChange,
  onUsage,
  _streamFn = streamAgentText,
  _subagentStreamFn = streamAgentText,
}: RunAgentTurnInput): AsyncGenerator<AgentPart> {
  if (!hasProviderConfig(providerConfig)) {
    yield {
      type: "text",
      text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。",
    };
    return;
  }

  const partQueue = createPartQueue();
  const askUser = createScopedAskUser({
    abortSignal,
    enqueuePart: (part) => {
      partQueue.push(part);
    },
    onAskUser,
  });

  const aiTools = buildAiSdkTools(
    workspaceTools,
    enabledToolIds,
    abortSignal,
    onToolRequestStateChange,
    {
      askUser,
    },
  );

  if (enabledToolIds.includes("task")) {
    aiTools.task = defineTool({
      description:
        [
          "按需创建【临时 subagent】在干净上下文中执行局部任务，并实时回传进度。",
          "✅ 适用：按章批量更新设定/状态、多主题资料搜索、批量拆爆款、风格诊断、合规检查等彼此独立的工作。",
          "❌ 禁用：写正文、续写章节、生成卷纲细纲——这些必须在主对话直写以保证连续性与文风一致。",
          "用法：单任务用 prompt，可传 agentName / role / instructions 描述临时角色；批量用 tasks[]（最多 8 个），每项也可单独传角色。",
          "公共前缀（章节摘要、人物清单等）放进 sharedContext，避免每个 prompt 重复塞，省 token。",
        ].join("\n"),
      inputSchema: taskToolInputSchema,
      execute: async (input: TaskToolInput) => {
        const { concurrency, isBatch, requests, sharedContext } =
          normalizeTaskToolInput(input);
        const runOne = (request: NormalizedTaskRequest) =>
          runTaskRequest({
	            abortSignal,
	            enabledSkills,
            enabledToolIds,
            providerConfig,
            request: {
              ...request,
              prompt: buildSubAgentPromptWithContext(request.prompt, sharedContext),
            },
            streamFn: _subagentStreamFn,
            workspaceTools,
            onProgress: (snapshot) => {
              throwIfAborted(abortSignal);
              partQueue.push(snapshot);
            },
          });

        const results = isBatch
          ? await runTaskBatch(requests, concurrency, runOne)
          : [await runOne(requests[0])];
        if (isBatch) {
          return buildTaskBatchOutput(results);
        }

        // 单任务也用统一 shape 返回，便于主代理判别 status。
        const output = results[0];
        return {
          status: output.status,
          agentName: output.agentName,
          summary: output.summary,
          subagentId: output.subagentId,
          ...(output.error ? { error: output.error } : {}),
        };
      },
    });
  }

  const system = buildSystemPrompt({
	    defaultAgentMarkdown,
	    enabledSkills,
	    enabledToolIds,
	    mode,
    modeContext,
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

  void (async () => {
    try {
      throwIfAborted(abortSignal);
      for await (const part of result.fullStream) {
        throwIfAborted(abortSignal);

        switch (part.type) {
          case "text-delta":
            partQueue.push({ type: "text-delta", delta: part.text });
            break;
          case "reasoning-delta":
            partQueue.push({
              type: "reasoning",
              summary: "正在思考",
              detail: part.text,
            });
            break;
          case "tool-call":
            partQueue.push({
              type: "tool-call",
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              status: "running",
              inputSummary: JSON.stringify(part.input),
            });
            break;
          case "tool-result":
            partQueue.push(
              createToolResultPart({
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                output: part.output,
              }),
            );
            break;
          default:
            break;
        }
      }

      throwIfAborted(abortSignal);
      const usage = result.usagePromise
        ? await withAbort(abortSignal, () => result.usagePromise as Promise<AgentUsage | null>)
        : null;
      if (usage) {
        onUsage?.(usage);
      }
      partQueue.close();
    } catch (error) {
      partQueue.close(error);
    }
  })();

  for await (const part of partQueue.stream()) {
    yield part;
  }
}

// 兼容旧 import 路径：保留这两个 export，避免触发外部消费者改动。
export { createSystemMessage };
export { runSubAgentTask };
