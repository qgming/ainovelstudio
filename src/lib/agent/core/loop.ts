import type { ModelMessage, ToolSet } from "ai";
import type { AgentProviderConfig } from "../../../stores/agentSettingsStore";
import { withAbort } from "../asyncUtils";
import { streamAgentText } from "../modelGateway";
import type { AgentPart, AgentUsage } from "../types";
import type { AgentSessionEvent } from "./events";
import { mapStreamPart, updateStepState, type StepStreamState } from "./streamParts";

const DEFAULT_MAX_AGENT_STEPS = 40;

export type AgentLoopContext = {
  messages: ModelMessage[];
  system: string;
  tools?: ToolSet;
};

export type AgentLoopConfig = {
  abortSignal?: AbortSignal;
  emit?: (event: AgentSessionEvent) => void;
  maxSteps?: number;
  onUsage?: (usage: AgentUsage) => void;
  providerConfig: AgentProviderConfig;
  sessionId?: string;
  streamFn?: typeof streamAgentText;
  takeFollowUpMessages?: () => string[];
  takeSteeringMessages?: () => string[];
};

function appendUserMessages(messages: ModelMessage[], prompts: string[]) {
  prompts.forEach((prompt) => {
    messages.push({ role: "user", content: prompt });
  });
}

function createAssistantEventMessage(turnId: string) {
  return {
    id: `assistant-${turnId}`,
    role: "assistant" as const,
    author: "主代理",
    parts: [] as AgentPart[],
  };
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

export async function* agentLoop(
  context: AgentLoopContext,
  config: AgentLoopConfig,
): AsyncGenerator<AgentPart> {
  const streamFn = config.streamFn ?? streamAgentText;
  const messages = [...context.messages];
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_AGENT_STEPS;

  config.emit?.({ type: "agent_start", sessionId: config.sessionId });
  for (let step = 0; step < maxSteps; step += 1) {
    const turnId = `${Date.now()}-${step + 1}`;
    const eventMessage = createAssistantEventMessage(turnId);
    config.emit?.({ type: "turn_start", prompt: "", turnId });
    config.emit?.({ type: "message_start", message: eventMessage });

    const result = streamFn({
      abortSignal: config.abortSignal,
      messages,
      providerConfig: config.providerConfig,
      singleStep: true,
      system: context.system,
      tools: context.tools,
    });
    const state: StepStreamState = { sawToolResult: false };

    for await (const streamPart of result.fullStream) {
      updateStepState(streamPart, state);
      const part = mapStreamPart(streamPart);
      if (!part) continue;
      eventMessage.parts.push(part);
      emitPartEvents(part, eventMessage.id, config.emit);
      yield part;
    }

    const usage = await collectStepUsage(result, config.abortSignal);
    if (usage) config.onUsage?.(usage);
    messages.push(...await collectResponseMessages(result, config.abortSignal));
    const finishReason = await collectFinishReason(result, state, config.abortSignal);
    config.emit?.({ type: "message_end", message: eventMessage });
    config.emit?.({ type: "turn_end", finishReason, turnId, usage });

    if (finishReason === "tool-calls") {
      appendUserMessages(messages, config.takeSteeringMessages?.() ?? []);
      continue;
    }

    const lateSteering = config.takeSteeringMessages?.() ?? [];
    if (lateSteering.length > 0) {
      appendUserMessages(messages, lateSteering);
      continue;
    }

    const followUps = config.takeFollowUpMessages?.() ?? [];
    if (followUps.length === 0) {
      config.emit?.({ type: "agent_end", sessionId: config.sessionId });
      return;
    }
    appendUserMessages(messages, followUps);
  }

  throw new Error(`Agent 达到最大单步次数 ${maxSteps}，已停止以避免无限循环。`);
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
