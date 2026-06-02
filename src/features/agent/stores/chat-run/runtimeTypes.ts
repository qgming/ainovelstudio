import type { AgentMode } from "@features/agent/lib/modes/modeRules";
import type { GoalRuntimeState } from "@features/agent/lib/domain/goalControl";
import type { WritingAgentSession } from "@features/agent/lib/session";
import type { ManualTurnContextSelection } from "@features/agent/lib/prompt-context/manualTurnContext";
import type { ChatRunStoreState, ChatRunStoreSetter } from "./helpers";

export const RUN_INTERRUPT_REASONS = ["manual_stop", "app_close", "restart", "reset", "coach"] as const;

export type RunInterruptReason = (typeof RUN_INTERRUPT_REASONS)[number];

export function isRunInterruptReason(value: unknown): value is RunInterruptReason {
  return typeof value === "string" && (RUN_INTERRUPT_REASONS as readonly string[]).includes(value);
}

export type SendMessageOptions = {
  goalIteration?: number;
  goalObjective?: string;
  goalState?: GoalRuntimeState;
  goalTokenBudget?: number | null;
  modeId?: AgentMode;
};

export type ChatRunStoreAccess = {
  get: () => ChatRunStoreState;
  set: ChatRunStoreSetter;
};

export type ActiveWritingSessionSlot = {
  abort: (reason: RunInterruptReason) => void;
  clear: () => void;
  current: () => WritingAgentSession | null;
  set: (session: WritingAgentSession, unsubscribe: () => void) => void;
};

export type SendMessageRequest = {
  options?: SendMessageOptions;
  promptOverride?: string | null;
  selection?: ManualTurnContextSelection;
};

export function createWritingSessionSlot(): ActiveWritingSessionSlot {
  let activeSession: WritingAgentSession | null = null;
  let unsubscribe: (() => void) | null = null;

  return {
    abort: (reason) => activeSession?.abort(reason),
    clear: () => {
      unsubscribe?.();
      unsubscribe = null;
      activeSession = null;
    },
    current: () => activeSession,
    set: (session, nextUnsubscribe) => {
      unsubscribe?.();
      activeSession = session;
      unsubscribe = nextUnsubscribe;
    },
  };
}
