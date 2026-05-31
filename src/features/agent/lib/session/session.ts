import type { ChatEntry } from "../../chat/types";
import type { AgentSessionEvent } from "./events";
import {
  WritingAgentSession,
  type QueueMode,
  type CompactionRunner,
} from "./sessionCore";
import { runWritingAgentHarness } from "./writingAgentHarnessRunner";
import type { WritingRuntimeContext } from "./writingRuntimeContext";

export type CreateWritingAgentSessionOptions = WritingRuntimeContext & {
  abortController?: AbortController;
  compact?: CompactionRunner;
  conversationEntries?: ChatEntry[];
  followUpMode?: QueueMode;
  onEvent?: (event: AgentSessionEvent) => void;
  // pi 持久会话 id（CP-C：用作 AgentHarness 的确定性会话 id，跨轮复用 jsonl 会话）。
  sessionId: string;
  steeringMode?: QueueMode;
};

export function createWritingAgentSession(options: CreateWritingAgentSessionOptions) {
  return new WritingAgentSession({
    abortController: options.abortController,
    compact: options.compact,
    followUpMode: options.followUpMode ?? "one-at-a-time",
    steeringMode: options.steeringMode ?? "one-at-a-time",
    runPrompt: ({ abortSignal, emit, prompt }) =>
      runWritingAgentHarness({
        abortSignal,
        prompt,
        sessionId: options.sessionId,
        toolContext: options,
        emit: (event) => {
          emit(event);
          options.onEvent?.(event);
        },
      }),
  });
}

export type { AgentSessionEvent, QueueMode, WritingAgentSession, WritingRuntimeContext };
