import type { AgentMode } from "@features/agent/lib/modeRules";
import type { WritingAgentSession } from "@features/agent/lib/session";
import type { ManualTurnContextSelection } from "@features/agent/lib/manualTurnContext";
import type { ChatRunStoreState, ChatRunStoreSetter } from "./helpers";

export type RunInterruptReason = "manual_stop" | "app_close" | "restart" | "reset" | "coach";

export type SendMessageOptions = {
  autopilotGoal?: string;
  autopilotIteration?: number;
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
