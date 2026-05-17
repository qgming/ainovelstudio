/**
 * 子代理任务执行：在干净上下文中委托一个子 agent 完成局部任务，并以 onProgress 报告进度。
 *
 * 之前定义在 session.ts 顶部，现拆分以便主回合主流程更清晰可读。
 */

import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { streamAgentText, type StreamAgentTextResult } from "./modelGateway";
import { buildSubAgentSystem } from "./promptContext";
import { buildAiSdkTools } from "./buildAiSdkTools";
import { createSubagentSnapshot, mergeSubagentInnerParts } from "./subagentParts";
import { throwIfAborted } from "./asyncUtils";
import { createToolResultPart } from "./toolParts";
import {
  MAX_SUBAGENT_MODEL_RESULT_CHARS,
  MAX_SUBAGENT_UI_DETAIL_CHARS,
  truncateTextWithMeta,
  type TruncatedText,
} from "./subagentOutput";
import type { AgentTool } from "./runtime";
import type { AgentPart } from "./types";
import type { RuntimeSubAgentProfile } from "./subagentProfile";

let subagentSequence = 0;

export type SubAgentExecutionMode = "execute" | "propose" | "readonly";

export type RunSubAgentTaskParams = {
  abortSignal?: AbortSignal;
  temporaryAgent?: TemporarySubAgentProfile;
  enabledSkills: ResolvedSkill[];
  taskPrompt: string;
  providerConfig: AgentProviderConfig;
  streamFn: typeof streamAgentText;
  workspaceTools: Record<string, AgentTool>;
  enabledToolIds: string[];
  maxResultChars?: number;
  mode?: SubAgentExecutionMode;
  onProgress?: (snapshot: AgentPart & { type: "subagent" }) => void;
};

export type TemporarySubAgentProfile = {
  body?: string;
  description?: string;
  name?: string;
  role?: string;
};

function buildSubagentId(agentId: string) {
  subagentSequence += 1;
  return `subagent-${agentId}-${Date.now()}-${subagentSequence}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "子代理执行失败。";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isResponseBodyDecodeError(error: unknown) {
  return error instanceof Error && error.message.includes("error decoding response body");
}

function stringifyInput(input: unknown) {
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function buildTemporaryAgent(profile?: TemporarySubAgentProfile): RuntimeSubAgentProfile {
  const name = profile?.name?.trim() || "临时 Subagent";
  const role = profile?.role?.trim() || "临时任务执行";
  const description = profile?.description?.trim() || "按当前 delegate_task 工具调用临时创建的一次性子代理。";
  const body = profile?.body?.trim() || [
    `# ${name}`,
    "",
    `角色：${role}`,
    "",
    description,
    "",
    "只处理父代理交给你的局部任务，优先输出高密度结论或可直接合并的结果。",
  ].join("\n");

  return {
    body,
    description,
    id: `temporary-${name}`,
    name,
    role,
  };
}

function buildModeInstruction(mode: SubAgentExecutionMode) {
  if (mode === "readonly") {
    return [
      "## 执行模式：readonly",
      "- 你只做读取、搜索、分析和诊断，不直接写入、移动、删除或修改任何资源。",
      "- 最终输出短结论、依据和建议动作；不要输出大段原文。",
    ].join("\n");
  }

  if (mode === "propose") {
    return [
      "## 执行模式：propose",
      "- 你可以读取和分析，但不要直接写入、移动、删除或修改任何资源。",
      "- 最终输出可执行方案或 patch 摘要，让父代理决定是否执行；不要输出大段原文。",
    ].join("\n");
  }

  return [
    "## 执行模式：execute",
    "- 你可以在父代理已启用的工具范围内直接执行局部操作，包括写文件、改 JSON、移动路径或整理状态。",
    "- 长结果必须优先落到工作区文件或状态 JSON；最终只返回执行报告。",
    "- 最终报告必须尽量短，包含：已执行操作、修改/读取的路径、失败项、需要父代理继续处理的事项。",
  ].join("\n");
}

function collectFinalText(innerParts: AgentPart[]) {
  return innerParts
    .filter(
      (part): part is Extract<AgentPart, { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");
}

function createProgressEmitter(
  onProgress: RunSubAgentTaskParams["onProgress"],
  intervalMs = 180,
) {
  let lastEmittedAt = 0;
  let emittedMeaningfulProgress = false;
  return (
    snapshot: AgentPart & { type: "subagent" },
    options?: { force?: boolean; meaningful?: boolean },
  ) => {
    if (!onProgress) return;
    const now = Date.now();
    const shouldEmit = options?.force
      || (options?.meaningful && !emittedMeaningfulProgress)
      || now - lastEmittedAt >= intervalMs;
    if (!shouldEmit) return;
    lastEmittedAt = now;
    emittedMeaningfulProgress ||= Boolean(options?.meaningful);
    onProgress(snapshot);
  };
}

function buildTextResult(text: string, maxResultChars?: number): TruncatedText {
  return truncateTextWithMeta(text, maxResultChars ?? MAX_SUBAGENT_MODEL_RESULT_CHARS);
}

export async function runSubAgentTask(
  params: RunSubAgentTaskParams,
): Promise<{
  agent: RuntimeSubAgentProfile;
  originalTextChars: number;
  subagentId: string;
  text: string;
  textTruncated: boolean;
}> {
  const {
    abortSignal,
    temporaryAgent,
    enabledSkills,
    taskPrompt,
    providerConfig,
    streamFn,
    workspaceTools,
    enabledToolIds,
    maxResultChars,
    mode = "execute",
    onProgress,
  } = params;

  const matchedAgent = buildTemporaryAgent(temporaryAgent);

  const subagentPrompt = [
    "这是父代理拆出的一个局部子任务，请在干净上下文中完成，并只返回必要摘要或结果。",
    buildModeInstruction(mode),
    "## 子任务请求",
    taskPrompt,
  ].join("\n\n");

  const subagentId = buildSubagentId(matchedAgent.id);
  const innerParts: AgentPart[] = [];
  const emitProgress = createProgressEmitter(onProgress);
  const subagentTools = buildAiSdkTools(
    workspaceTools,
    enabledToolIds,
    abortSignal,
    undefined,
  );

  throwIfAborted(abortSignal);
  emitProgress(
    createSubagentSnapshot({
      id: subagentId,
      name: matchedAgent.name,
      status: "running",
      summary: `已派发子任务：${matchedAgent.name}`,
      parts: innerParts,
    }),
    { force: true },
  );

  let recoveredFromDecodeError = false;
  try {
    // 2. 调用 LLM 并流式收集片段。
    const result = streamFn({
      abortSignal,
      messages: [{ role: "user", content: subagentPrompt }],
      providerConfig,
      system: buildSubAgentSystem(matchedAgent, enabledSkills),
      tools: Object.keys(subagentTools).length > 0 ? subagentTools : undefined,
    });

    for await (const part of result.fullStream) {
      throwIfAborted(abortSignal);
      const mappedPart = mapSubagentStreamPart(part);
      if (!mappedPart) {
        continue;
      }

      const mergedParts = mergeSubagentInnerParts(innerParts, mappedPart);
      innerParts.splice(0, innerParts.length, ...mergedParts);
      throwIfAborted(abortSignal);
      emitProgress(
        createSubagentSnapshot({
          id: subagentId,
          name: matchedAgent.name,
          status: "running",
          summary: `${matchedAgent.name} 子任务执行中`,
          parts: innerParts,
        }),
        { meaningful: true },
      );
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (isResponseBodyDecodeError(error) && collectFinalText(innerParts).trim()) {
      recoveredFromDecodeError = true;
    } else {
      onProgress?.(
        createSubagentSnapshot({
          id: subagentId,
          name: matchedAgent.name,
          status: "failed",
          summary: `${matchedAgent.name} 子任务失败`,
          detail: getErrorMessage(error),
          parts: innerParts,
        }),
      );
      throw error;
    }
  }

  // 3. 汇总文本片段作为子任务的最终摘要。
  const finalText = collectFinalText(innerParts);
  const resultText = buildTextResult(finalText, maxResultChars);
  const detailText = truncateTextWithMeta(finalText, MAX_SUBAGENT_UI_DETAIL_CHARS);
  const completionSummary = recoveredFromDecodeError
    ? `${matchedAgent.name} 子任务已完成（流式解码异常，已保留可用输出）`
    : `${matchedAgent.name} 子任务已完成`;

  throwIfAborted(abortSignal);
  emitProgress(
    createSubagentSnapshot({
      id: subagentId,
      name: matchedAgent.name,
      status: "completed",
      summary: completionSummary,
      detail: detailText.text,
      parts: innerParts,
    }),
    { force: true },
  );

  return {
    agent: matchedAgent,
    originalTextChars: resultText.originalChars,
    text: resultText.text,
    textTruncated: resultText.truncated,
    subagentId,
  };
}

type SubagentStreamPart = StreamAgentTextResult["fullStream"] extends AsyncIterable<infer T>
  ? T
  : never;

function mapSubagentStreamPart(part: SubagentStreamPart): AgentPart | null {
  switch (part.type) {
    case "text-delta":
      return { type: "text-delta", delta: part.text };
    case "reasoning-delta":
      return {
        type: "reasoning",
        summary: "",
        detail: part.text,
      };
    case "tool-call":
      return {
        type: "tool-call",
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        status: "running",
        inputSummary: stringifyInput(part.input),
      };
    case "tool-result":
      return createToolResultPart({
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        output: part.output,
      });
    default:
      return null;
  }
}
