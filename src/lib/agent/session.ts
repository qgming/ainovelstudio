import type { ChatEntry } from "../chat/types";
import type { AgentSessionEvent } from "./core/events";
import {
  WritingAgentSession,
  type QueueMode,
  type CompactionRunner,
} from "./core/session";
import { runWritingPrompt } from "./writingPrompt";
import type { WritingToolContext } from "./writingToolContext";

export type CreateWritingAgentSessionOptions = WritingToolContext & {
  abortController?: AbortController;
  compact?: CompactionRunner;
  conversationEntries?: ChatEntry[];
  followUpMode?: QueueMode;
  onEvent?: (event: AgentSessionEvent) => void;
  steeringMode?: QueueMode;
};

export function createWritingAgentSession(options: CreateWritingAgentSessionOptions) {
  return new WritingAgentSession({
    abortController: options.abortController,
    compact: options.compact,
    followUpMode: options.followUpMode ?? "one-at-a-time",
    steeringMode: options.steeringMode ?? "one-at-a-time",
    runPrompt: ({ abortSignal, emit, prompt, takeFollowUpMessages, takeSteeringMessages }) =>
      runWritingPrompt({
        abortSignal,
        prompt,
        takeFollowUpMessages,
        takeSteeringMessages,
        toolContext: options,
        emit: (event) => {
          emit(event);
          options.onEvent?.(event);
        },
      }),
  });
}

export type { AgentSessionEvent, QueueMode, WritingAgentSession, WritingToolContext };
