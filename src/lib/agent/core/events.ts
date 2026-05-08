import type { AgentMessage, AgentPart, AgentUsage } from "../types";

export type AgentEvent =
  | { type: "agent_start"; sessionId?: string }
  | { type: "agent_end"; error?: string; sessionId?: string }
  | { type: "turn_start"; prompt: string; turnId: string }
  | { type: "turn_end"; finishReason?: string; turnId: string; usage?: AgentUsage | null }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; messageId: string; part: AgentPart }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_update"; part: AgentPart; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; part: AgentPart; toolCallId: string; toolName: string };

export type AgentSessionEvent =
  | AgentEvent
  | { type: "queue_update"; followUp: readonly string[]; steering: readonly string[] }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction_end";
      aborted: boolean;
      errorMessage?: string;
      reason: "manual" | "threshold" | "overflow";
      summary?: string;
    };

export type AgentEventListener = (event: AgentSessionEvent) => void;

