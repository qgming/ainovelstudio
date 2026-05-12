import { z } from "zod";
import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { throwIfAborted } from "./asyncUtils";
import { defineTool, streamAgentText } from "./modelGateway";
import { runSubAgentTask, type TemporarySubAgentProfile } from "./runSubAgentTask";
import type { AgentTool } from "./runtime";
import type { AgentPart } from "./types";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import type { AgentToolPromptSpec } from "./ai-sdk-tools/toolPromptSpecs";

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
  id: z.string().optional().describe("可选。批量任务里的稳定短 ID，便于结果回填，例如 scan-urban。"),
  prompt: z.string().min(1).describe("需要外包给子代理的局部任务指令。必须写清输入范围、可用文件/关键词、期望输出；不要让子代理写正文或改文件。"),
  agentName: z.string().optional().describe("可选。临时 subagent 名称，短名称即可。"),
  role: z.string().optional().describe("可选。临时 subagent 的专业角色，例如“榜单分析员”“连续性检查员”。"),
  instructions: z.string().optional().describe("可选。临时 subagent 的执行约束或专长说明，例如只输出结论、不要改文件。"),
});

const taskToolInputSchema = z.object({
  prompt: z.string().min(1).optional().describe("单个子任务指令。prompt 和 tasks 二选一；单任务用 prompt，批量用 tasks。"),
  agentName: z.string().optional().describe("单任务临时 subagent 名称。"),
  role: z.string().optional().describe("单任务临时 subagent 角色。"),
  instructions: z.string().optional().describe("单任务临时 subagent 执行说明和边界。"),
  tasks: z.array(taskItemInputSchema).min(1).max(MAX_TASK_BATCH_SIZE).optional().describe("批量子任务数组。适合彼此独立的资料搜索、诊断、检查；不要放强依赖前后结果的任务。"),
  concurrency: z.number().int().min(1).max(MAX_TASK_BATCH_CONCURRENCY).optional().describe("批量并发数，默认 2，最大 4；任务重或会读大量文件时用 1-2。"),
  sharedContext: z.string().min(1).optional().describe("批量任务共享背景资料，避免每个 prompt 重复。放章节摘要、目标、边界、输入文件清单等。"),
}).refine((input) => Boolean(input.prompt || input.tasks?.length), {
  message: "必须提供 prompt 或 tasks。",
});

export const TASK_TOOL_SPEC = {
  description: [
    "按需创建【临时 subagent】在干净上下文中执行局部任务，并实时回传进度。",
    "适用：按章批量更新设定/状态、多主题资料搜索、批量拆爆款、风格诊断、合规检查等彼此独立的工作。",
    "禁用：写正文、续写章节、生成卷纲细纲、需要主代理立即写回的强连续任务；这些必须在主对话直写以保证连续性与文风一致。",
    "用法：单任务传 prompt；批量任务传 tasks[] 和可选 sharedContext。子代理结果只回到父代理，不会自动写文件。",
  ].join("\n"),
  inputSchema: taskToolInputSchema,
} satisfies AgentToolPromptSpec;

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
    description: TASK_TOOL_SPEC.description,
    inputSchema: TASK_TOOL_SPEC.inputSchema,
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
