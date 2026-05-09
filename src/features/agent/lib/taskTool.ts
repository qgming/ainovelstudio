import { z } from "zod";
import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { throwIfAborted } from "./asyncUtils";
import { defineTool, streamAgentText } from "./modelGateway";
import { runSubAgentTask, type TemporarySubAgentProfile } from "./runSubAgentTask";
import type { AgentTool } from "./runtime";
import type { AgentPart } from "./types";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";

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

const taskToolInputSchema = z.object({
  prompt: z.string().min(1).optional().describe("单个子任务指令。"),
  agentName: z.string().optional().describe("单任务临时 subagent 名称。"),
  role: z.string().optional().describe("单任务临时 subagent 角色。"),
  instructions: z.string().optional().describe("单任务临时 subagent 执行说明。"),
  tasks: z.array(taskItemInputSchema).min(1).max(MAX_TASK_BATCH_SIZE).optional(),
  concurrency: z.number().int().min(1).max(MAX_TASK_BATCH_CONCURRENCY).optional(),
  sharedContext: z.string().min(1).optional(),
}).refine((input) => Boolean(input.prompt || input.tasks?.length), {
  message: "必须提供 prompt 或 tasks。",
});

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function buildTemporaryAgentProfile(input: {
  agentName?: string;
  instructions?: string;
  role?: string;
}): TemporarySubAgentProfile | undefined {
  const name = input.agentName?.trim();
  const role = input.role?.trim();
  const instructions = input.instructions?.trim();
  if (!name && !role && !instructions) return undefined;
  return { body: instructions, description: instructions, name, role };
}

function normalizeTaskToolInput(input: TaskToolInput) {
  const requests = input.tasks?.length
    ? input.tasks.map((task, index) => ({
      id: task.id?.trim() || `task-${index + 1}`,
      prompt: task.prompt,
      temporaryAgent: buildTemporaryAgentProfile(task),
    }))
    : [{ id: "task-1", prompt: input.prompt ?? "", temporaryAgent: buildTemporaryAgentProfile(input) }];
  const concurrency = input.tasks?.length ? input.concurrency ?? DEFAULT_TASK_BATCH_CONCURRENCY : 1;
  return {
    concurrency: Math.min(concurrency, MAX_TASK_BATCH_CONCURRENCY, requests.length),
    isBatch: Boolean(input.tasks?.length),
    requests,
    sharedContext: input.sharedContext?.trim() || undefined,
  };
}

function buildSubAgentPromptWithContext(prompt: string, sharedContext?: string) {
  return sharedContext
    ? ["## 共享上下文", sharedContext, "", "## 当前子任务", prompt].join("\n")
    : prompt;
}

async function runTaskBatch(
  requests: NormalizedTaskRequest[],
  concurrency: number,
  runOne: (request: NormalizedTaskRequest) => Promise<TaskExecutionResult>,
) {
  const results: TaskExecutionResult[] = [];
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, async () => {
    while (nextIndex < requests.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await runOne(requests[currentIndex]);
    }
  }));
  return results;
}

function buildTaskBatchOutput(results: TaskExecutionResult[]) {
  const completed = results.filter((result) => result.status === "completed").length;
  return { mode: "batch", total: results.length, completed, failed: results.length - completed, results };
}

async function runTaskRequest(params: {
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
      abortSignal: params.abortSignal,
      temporaryAgent: params.request.temporaryAgent,
      enabledSkills: params.enabledSkills,
      taskPrompt: params.request.prompt,
      providerConfig: params.providerConfig,
      streamFn: params.streamFn,
      workspaceTools: params.workspaceTools,
      enabledToolIds: params.enabledToolIds.filter((toolId) => toolId !== "task"),
      onProgress: params.onProgress,
    });
    return { id: params.request.id, status: "completed", agentName: output.agent.name, summary: output.text, subagentId: output.subagentId };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { id: params.request.id, status: "failed", summary: getErrorMessage(error, "子任务执行失败。"), error: getErrorMessage(error, "子任务执行失败。") };
  }
}

export function createTaskTool(params: {
  abortSignal?: AbortSignal;
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  enqueuePart: (part: AgentPart) => void;
  providerConfig: AgentProviderConfig;
  streamFn: typeof streamAgentText;
  workspaceTools: Record<string, AgentTool>;
}) {
  return defineTool({
    description: [
      "按需创建【临时 subagent】在干净上下文中执行局部任务，并实时回传进度。",
      "适用：按章批量更新设定/状态、多主题资料搜索、批量拆爆款、风格诊断、合规检查等彼此独立的工作。",
      "禁用：写正文、续写章节、生成卷纲细纲，这些必须在主对话直写以保证连续性与文风一致。",
    ].join("\n"),
    inputSchema: taskToolInputSchema,
    execute: async (input: TaskToolInput) => {
      const normalized = normalizeTaskToolInput(input);
      const runOne = (request: NormalizedTaskRequest) => runTaskRequest({
        ...params,
        request: { ...request, prompt: buildSubAgentPromptWithContext(request.prompt, normalized.sharedContext) },
        onProgress: (snapshot) => {
          throwIfAborted(params.abortSignal);
          params.enqueuePart(snapshot);
        },
      });
      const results = normalized.isBatch
        ? await runTaskBatch(normalized.requests, normalized.concurrency, runOne)
        : [await runOne(normalized.requests[0])];
      return normalized.isBatch ? buildTaskBatchOutput(results) : results[0];
    },
  });
}
