import type { ModelMessage, ToolSet } from "ai";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { withAbort } from "../asyncUtils";
import { streamAgentText } from "../modelGateway";
import type { AgentPart, AgentUsage } from "../types";
import type { AgentSessionEvent } from "./events";
import {
  appendRetryPrompt,
  buildFailureReport,
  createFailureRecord,
  createRetryState,
  isAbortError,
  isNonRetryableAiRequestError,
  MAX_CONSECUTIVE_AI_REQUEST_FAILURES,
  type RetryState,
} from "./retry";
import { mapStreamPart, updateStepState, type StepStreamState } from "./streamParts";

const DEFAULT_MAX_AGENT_STEPS = 100;

export type AgentLoopContext = {
  messages: ModelMessage[];
  system: string;
  tools?: ToolSet;
};

export type AgentLoopConfig = {
  abortSignal?: AbortSignal;
  emit?: (event: AgentSessionEvent) => void;
  maxSteps?: number | null;
  onUsage?: (usage: AgentUsage) => void;
  providerConfig: AgentProviderConfig;
  sessionId?: string;
  streamFn?: typeof streamAgentText;
  takeFollowUpMessages?: () => string[];
  takeSteeringMessages?: () => string[];
};

type AgentStepParams = {
  abortSignal?: AbortSignal;
  emit?: (event: AgentSessionEvent) => void;
  eventMessage: ReturnType<typeof createAssistantEventMessage>;
  messages: ModelMessage[];
  providerConfig: AgentProviderConfig;
  streamFn: typeof streamAgentText;
  system: string;
  tools?: ToolSet;
  turnId: string;
  onUsage?: (usage: AgentUsage) => void;
};

type AgentStepResult = {
  finishReason?: string;
};

type RunStepWithRetryParams = {
  config: AgentLoopConfig;
  context: AgentLoopContext;
  eventMessage: ReturnType<typeof createAssistantEventMessage>;
  messages: ModelMessage[];
  retryState: RetryState;
  streamFn: typeof streamAgentText;
  turnId: string;
};

function appendUserMessages(messages: ModelMessage[], prompts: string[]) {
  prompts.forEach((prompt) => {
    messages.push({ role: "user", content: prompt });
  });
}

function appendUserMessagesAndCheck(messages: ModelMessage[], prompts: string[]) {
  appendUserMessages(messages, prompts);
  return prompts.length > 0;
}

function normalizeMaxSteps(maxSteps: number | null | undefined) {
  if (maxSteps === null) return null;
  if (typeof maxSteps === "number" && maxSteps > 0) return maxSteps;
  return DEFAULT_MAX_AGENT_STEPS;
}

function assertStepBudget(stepsSinceUserMessage: number, maxSteps: number | null) {
  if (maxSteps === null || stepsSinceUserMessage < maxSteps) return;
  throw new Error(`Agent 达到最大单步次数 ${maxSteps}，已停止以避免无限循环。`);
}

function createAssistantEventMessage(turnId: string) {
  return {
    id: `assistant-${turnId}`,
    role: "assistant" as const,
    author: "主代理",
    parts: [] as AgentPart[],
  };
}

function isResponseBodyDecodeError(error: unknown) {
  return error instanceof Error && error.message.includes("error decoding response body");
}

function canCompleteAfterDecodeError(parts: AgentPart[]) {
  return parts.length > 0 && parts.every((part) =>
    part.type === "text-delta" || part.type === "reasoning" || part.type === "text"
  );
}

function collectAssistantContent(parts: AgentPart[]) {
  return parts
    .map((part) => {
      if (part.type === "text-delta") return part.delta;
      if (part.type === "text") return part.text;
      if (part.type === "reasoning") return part.detail;
      return "";
    })
    .join("")
    .trim();
}

function hasToolActivity(parts: AgentPart[]) {
  return parts.some((part) => part.type === "tool-call" || part.type === "tool-result");
}

function shouldAutoContinueAfterPossibleDroppedToolCall(
  finishReason: string | undefined,
  parts: AgentPart[],
) {
  if (finishReason === "tool-calls" || hasToolActivity(parts)) return false;
  const content = collectAssistantContent(parts);
  if (!content) return false;
  return /(?:先|准备|继续|接下来|随后|然后|马上|开始).{0,36}(?:落盘|写入|回写|保存|同步|更新|创建|调用|执行|处理|补完|补上|补齐)/.test(content)
    || /(?:会|将|要).{0,36}(?:落盘|写入|回写|保存|同步|更新|创建|调用|执行|处理|补完|补上|补齐)/.test(content)
    || /(?:落盘|写入|回写|保存|同步|更新|创建|调用|执行|处理|补完|补上|补齐).{0,36}(?:正文|章节|状态|文件|工具|内容)/.test(content)
    || /(?:I\s+(?:need|should|will|must)|need to|should|must|planning|draft|append|continue|task requires)/i.test(content);
}

function buildDroppedToolCallRecoveryPrompt(content: string) {
  return [
    "系统检测到上一条助手消息只输出了行动预告，但没有产生可执行的工具调用，不能结束本轮任务。",
    "请把下面这段助手内容当作上一轮未完成的执行意图，继续下一轮并完成它：",
    "",
    content,
    "",
    "不要重复这段预告，也不要只解释计划；请继续执行必要动作，完成后再汇报结果。",
  ].join("\n");
}

async function collectStepUsage(
  result: ReturnType<typeof streamAgentText>,
  abortSignal?: AbortSignal,
) {
  if (!result.usagePromise) return null;
  return withAbort(abortSignal, () => result.usagePromise as Promise<AgentUsage | null>);
}

async function collectResponseMessages(
  result: ReturnType<typeof streamAgentText>,
  abortSignal?: AbortSignal,
) {
  if (!result.responseMessagesPromise) return [];
  return withAbort(abortSignal, () => result.responseMessagesPromise as Promise<ModelMessage[]>);
}

async function collectFinishReason(
  result: ReturnType<typeof streamAgentText>,
  state: StepStreamState,
  abortSignal?: AbortSignal,
) {
  if (state.finishReason || !result.finishReasonPromise) return state.finishReason;
  return withAbort(abortSignal, () => result.finishReasonPromise as Promise<string>);
}

async function* runAgentStep(params: AgentStepParams): AsyncGenerator<AgentPart, AgentStepResult> {
  params.emit?.({ type: "turn_start", prompt: "", turnId: params.turnId });
  params.emit?.({ type: "message_start", message: params.eventMessage });

  const result = params.streamFn({
    abortSignal: params.abortSignal,
    messages: params.messages,
    providerConfig: params.providerConfig,
    singleStep: true,
    system: params.system,
    tools: params.tools,
  });
  const state: StepStreamState = { sawToolResult: false };

  for await (const streamPart of result.fullStream) {
    updateStepState(streamPart, state);
    const part = mapStreamPart(streamPart);
    if (!part) continue;
    params.eventMessage.parts.push(part);
    emitPartEvents(part, params.eventMessage.id, params.emit);
    yield part;
  }

  const usage = await collectStepUsage(result, params.abortSignal);
  if (usage) params.onUsage?.(usage);
  params.messages.push(...await collectResponseMessages(result, params.abortSignal));
  const finishReason = await collectFinishReason(result, state, params.abortSignal);
  params.emit?.({ type: "message_end", message: params.eventMessage });
  params.emit?.({ type: "turn_end", finishReason, turnId: params.turnId, usage });
  return { finishReason };
}

async function* runStepWithRetry(
  params: RunStepWithRetryParams,
): AsyncGenerator<AgentPart, AgentStepResult & { shouldRetry: boolean }> {
  try {
    const stepResult = yield* runAgentStep({
      abortSignal: params.config.abortSignal,
      emit: params.config.emit,
      eventMessage: params.eventMessage,
      messages: params.messages,
      onUsage: params.config.onUsage,
      providerConfig: params.config.providerConfig,
      streamFn: params.streamFn,
      system: params.context.system,
      tools: params.context.tools,
      turnId: params.turnId,
    });
    params.retryState.consecutiveFailures = 0;
    params.retryState.failureHistory = [];
    return { ...stepResult, shouldRetry: false };
  } catch (error) {
    if (isAbortError(error, params.config.abortSignal)) throw error;
    if (isNonRetryableAiRequestError(error)) throw error;
    if (isResponseBodyDecodeError(error) && canCompleteAfterDecodeError(params.eventMessage.parts)) {
      const content = collectAssistantContent(params.eventMessage.parts);
      if (content) params.messages.push({ role: "assistant", content });
      params.retryState.consecutiveFailures = 0;
      params.retryState.failureHistory = [];
      params.config.emit?.({ type: "message_end", message: params.eventMessage });
      params.config.emit?.({
        type: "turn_end",
        finishReason: "stop",
        turnId: params.turnId,
        usage: null,
      });
      return { finishReason: "stop", shouldRetry: false };
    }
    const failure = recordStepFailure(error, params);
    if (params.retryState.consecutiveFailures >= MAX_CONSECUTIVE_AI_REQUEST_FAILURES) {
      throw new Error(buildFailureReport(params.retryState.failureHistory, params.config.providerConfig), {
        cause: error,
      });
    }
    appendRetryPrompt(params.messages, failure);
    return { shouldRetry: true };
  }
}

function recordStepFailure(error: unknown, params: RunStepWithRetryParams) {
  const retryState = params.retryState;
  retryState.consecutiveFailures += 1;
  const failure = createFailureRecord({
    attempt: retryState.consecutiveFailures,
    error,
    partsGenerated: params.eventMessage.parts.length,
    turnId: params.turnId,
  });
  retryState.failureHistory = [...retryState.failureHistory, failure];
  params.config.emit?.({ type: "message_end", message: params.eventMessage });
  params.config.emit?.({ type: "turn_end", finishReason: "auto-retry", turnId: params.turnId, usage: null });
  return failure;
}

export async function* agentLoop(
  context: AgentLoopContext,
  config: AgentLoopConfig,
): AsyncGenerator<AgentPart> {
  const streamFn = config.streamFn ?? streamAgentText;
  const messages = [...context.messages];
  const maxSteps = normalizeMaxSteps(config.maxSteps);
  const retryState = createRetryState();
  let totalSteps = 0;
  let stepsSinceUserMessage = 0;
  let recoveredDroppedToolCall = false;

  config.emit?.({ type: "agent_start", sessionId: config.sessionId });
  while (true) {
    assertStepBudget(stepsSinceUserMessage, maxSteps);
    totalSteps += 1;
    stepsSinceUserMessage += 1;
    const turnId = `${Date.now()}-${totalSteps}`;
    const eventMessage = createAssistantEventMessage(turnId);
    const { finishReason, shouldRetry } = yield* runStepWithRetry({
      config,
      context,
      eventMessage,
      messages,
      retryState,
      streamFn,
      turnId,
    });

    if (shouldRetry) {
      stepsSinceUserMessage = 0;
      continue;
    }

    if (finishReason === "tool-calls") {
      recoveredDroppedToolCall = false;
      const steeringMessages = config.takeSteeringMessages?.() ?? [];
      if (appendUserMessagesAndCheck(messages, steeringMessages)) stepsSinceUserMessage = 0;
      continue;
    }

    if (
      !recoveredDroppedToolCall
      && shouldAutoContinueAfterPossibleDroppedToolCall(finishReason, eventMessage.parts)
    ) {
      recoveredDroppedToolCall = true;
      appendUserMessages(messages, [buildDroppedToolCallRecoveryPrompt(collectAssistantContent(eventMessage.parts))]);
      stepsSinceUserMessage = 0;
      continue;
    }

    const lateSteering = config.takeSteeringMessages?.() ?? [];
    if (lateSteering.length > 0) {
      appendUserMessages(messages, lateSteering);
      stepsSinceUserMessage = 0;
      recoveredDroppedToolCall = false;
      continue;
    }

    const followUps = config.takeFollowUpMessages?.() ?? [];
    if (followUps.length === 0) {
      config.emit?.({ type: "agent_end", sessionId: config.sessionId });
      return;
    }
    if (appendUserMessagesAndCheck(messages, followUps)) stepsSinceUserMessage = 0;
  }
}

function emitPartEvents(
  part: AgentPart,
  messageId: string,
  emit?: (event: AgentSessionEvent) => void,
) {
  emit?.({ type: "message_update", messageId, part });
  if (part.type === "tool-call") {
    emit?.({ type: "tool_execution_start", toolCallId: part.toolCallId, toolName: part.toolName });
  }
  if (part.type === "tool-result") {
    emit?.({ type: "tool_execution_end", part, toolCallId: part.toolCallId, toolName: part.toolName });
  }
}
