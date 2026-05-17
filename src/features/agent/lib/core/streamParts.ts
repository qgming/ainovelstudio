import type { StreamAgentTextResult } from "../modelGateway";
import { createToolResultPart } from "../toolParts";
import type { AgentPart } from "../types";

export type AgentStreamPart = StreamAgentTextResult["fullStream"] extends AsyncIterable<infer T>
  ? T
  : never;

export type StepStreamState = {
  finishReason?: string;
  sawToolResult: boolean;
};

function stringifyInput(input: unknown) {
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

export function mapStreamPart(part: AgentStreamPart): AgentPart | null {
  switch (part.type) {
    case "text-delta":
      return { type: "text-delta", delta: part.text };
    case "reasoning-delta":
      return { type: "reasoning", summary: "", detail: part.text };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        status: "running",
        inputSummary: stringifyInput(part.input),
      };
    case "tool-result":
      return createToolResultPart({
        output: part.output,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
      });
    case "tool-error":
      return createToolResultPart({
        output: part.error,
        status: "failed",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
      });
    default:
      return null;
  }
}

export function updateStepState(part: AgentStreamPart, state: StepStreamState) {
  if (part.type === "finish-step" || part.type === "finish") {
    state.finishReason = part.finishReason;
  }
  if (part.type === "tool-result" || part.type === "tool-error") {
    state.sawToolResult = true;
  }
}

