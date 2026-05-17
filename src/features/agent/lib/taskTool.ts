import { z } from "zod";
import type { JSONValue } from "ai";
import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { throwIfAborted } from "./asyncUtils";
import { defineTool, streamAgentText } from "./modelGateway";
import { runSubAgentTask, type SubAgentExecutionMode, type TemporarySubAgentProfile } from "./runSubAgentTask";
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
  maxResultChars?: number;
  mode?: SubAgentExecutionMode;
};

type TaskToolInput = {
  prompt?: string;
  agentName?: string;
  role?: string;
  instructions?: string;
  maxResultChars?: number;
  mode?: SubAgentExecutionMode;
  tasks?: TaskToolItemInput[];
  concurrency?: number;
  sharedContext?: string;
};

type NormalizedTaskRequest = {
  id: string;
  maxResultChars?: number;
  mode: SubAgentExecutionMode;
  prompt: string;
  temporaryAgent?: TemporarySubAgentProfile;
};

type TaskExecutionResult = {
  agentName?: string;
  mode: SubAgentExecutionMode;
  id: string;
  originalSummaryChars?: number;
  status: "completed" | "failed";
  subagentId?: string;
  summary: string;
  summaryTruncated?: boolean;
  error?: string;
};

const taskModeSchema = z
  .enum(["readonly", "propose", "execute"])
  .optional()
  .describe("子代理模式。execute 可直接调用已启用工具落盘；readonly 只读分析；propose 只给方案不执行。默认 execute。");

const taskItemInputSchema = z.object({
  id: z.string().optional().describe("可选。批量任务里的稳定短 ID，便于结果回填，例如 scan-urban。"),
  prompt: z.string().min(1).describe("需要外包给子代理的局部任务指令。必须写清输入范围、可用文件/关键词、期望输出；不要让子代理写正文或改文件。"),
  agentName: z.string().optional().describe("可选。临时 subagent 名称，短名称即可。"),
  role: z.string().optional().describe("可选。临时 subagent 的专业角色，例如“榜单分析员”“连续性检查员”。"),
  instructions: z.string().optional().describe("可选。临时 subagent 的执行约束或专长说明，例如只输出结论、不要改文件。"),
  maxResultChars: z.number().int().positive().max(12000).optional().describe("可选。该子任务回传给父代理的最大摘要字符数，默认 6000；长结果应写入文件而不是回传全文。"),
  mode: taskModeSchema,
});

const taskToolInputSchema = z.object({
  prompt: z.string().min(1).optional().describe("单个子任务指令。prompt 和 tasks 二选一；单任务用 prompt，批量用 tasks。"),
  agentName: z.string().optional().describe("单任务临时 subagent 名称。"),
  role: z.string().optional().describe("单任务临时 subagent 角色。"),
  instructions: z.string().optional().describe("单任务临时 subagent 执行说明和边界。"),
  maxResultChars: z.number().int().positive().max(12000).optional().describe("单任务回传给父代理的最大摘要字符数，默认 6000；长结果应写入文件而不是回传全文。"),
  mode: taskModeSchema,
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
    "禁用：续写正文、生成大段卷纲细纲、需要主代理立即保持文风连续的任务；这些必须在主对话直写。",
    "用法：单任务传 prompt；批量任务传 tasks[] 和可选 sharedContext。默认 mode=execute，子代理可直接执行已启用工具；只想分析时传 readonly，需要方案但不落盘时传 propose。",
    "稳定性：长结果必须让子代理写入工作区文件或 JSON，最终只回短执行报告、路径、失败项和下一步。",
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

function normalizeTaskMode(mode?: SubAgentExecutionMode): SubAgentExecutionMode {
  return mode ?? "execute";
}

function normalizeTaskToolInput(input: TaskToolInput) {
  const requests = input.tasks?.length
    ? input.tasks.map((task, index) => ({
      id: task.id?.trim() || `task-${index + 1}`,
      maxResultChars: task.maxResultChars ?? input.maxResultChars,
      mode: normalizeTaskMode(task.mode ?? input.mode),
      prompt: task.prompt,
      temporaryAgent: buildTemporaryAgentProfile(task),
    }))
    : [{
      id: "task-1",
      maxResultChars: input.maxResultChars,
      mode: normalizeTaskMode(input.mode),
      prompt: input.prompt ?? "",
      temporaryAgent: buildTemporaryAgentProfile(input),
    }];
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

const READONLY_SUBAGENT_TOOL_IDS = new Set([
  "leaderboard",
  "project_memory_search",
  "skill_read",
  "text_stats",
  "web_read",
  "web_search",
  "workspace_browse",
  "workspace_read",
  "workspace_search",
]);

function filterSubagentToolIds(toolIds: string[], mode: SubAgentExecutionMode) {
  const withoutDelegation = toolIds.filter((toolId) => toolId !== "delegate_task");
  if (mode === "execute") return withoutDelegation;
  return withoutDelegation.filter((toolId) => READONLY_SUBAGENT_TOOL_IDS.has(toolId));
}

function taskToolToModelOutput(
  { output }: { output: TaskExecutionResult | ReturnType<typeof buildTaskBatchOutput> },
) {
  return { type: "json" as const, value: output as JSONValue };
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
      maxResultChars: params.request.maxResultChars,
      mode: params.request.mode,
      streamFn: params.streamFn,
      workspaceTools: params.workspaceTools,
      enabledToolIds: filterSubagentToolIds(params.enabledToolIds, params.request.mode),
      onProgress: params.onProgress,
    });
    return {
      id: params.request.id,
      status: "completed",
      agentName: output.agent.name,
      mode: params.request.mode,
      originalSummaryChars: output.originalTextChars,
      summary: output.text,
      summaryTruncated: output.textTruncated,
      subagentId: output.subagentId,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      id: params.request.id,
      status: "failed",
      mode: params.request.mode,
      summary: getErrorMessage(error, "子任务执行失败。"),
      error: getErrorMessage(error, "子任务执行失败。"),
    };
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
    toModelOutput: taskToolToModelOutput,
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
