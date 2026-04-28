import type { AgentPart, AgentRunStatus } from "./types";

const MISSING_TOOL_CALL_ID_ERROR = "toolCallId 缺失。";
const TOOL_CALL_NOT_FOUND_ERROR = "未匹配到对应的工具调用。";
const TOOL_NAME_MISMATCH_ERROR = "toolName 与工具调用不一致。";
const TOOL_CALL_NOT_RUNNING_ERROR = "未匹配到运行中的工具调用。";
const DUPLICATE_TOOL_CALL_ERROR = "匹配到多个运行中的同 ID 工具调用。";

function normalizeToolCallId(toolCallId: string) {
  return toolCallId.trim();
}

export function summarizeToolOutput(output: unknown) {
  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output) ?? "";
  } catch {
    return "";
  }
}

type ToolResultPart = Extract<AgentPart, { type: "tool-result" }>;
type ToolCallPart = Extract<AgentPart, { type: "tool-call" }>;

function findToolCallCandidates(parts: AgentPart[], toolCallId: string) {
  return parts.flatMap((part, index) => {
    if (part.type !== "tool-call") {
      return [];
    }

    return normalizeToolCallId(part.toolCallId) === toolCallId ? [{ index, part }] : [];
  });
}

function resolveToolResultTarget(parts: AgentPart[], part: ToolResultPart) {
  const normalizedToolCallId = normalizeToolCallId(part.toolCallId);
  if (!normalizedToolCallId) {
    return { toolCallId: normalizedToolCallId, validationError: MISSING_TOOL_CALL_ID_ERROR };
  }

  const matchedById = findToolCallCandidates(parts, normalizedToolCallId);
  if (matchedById.length === 0) {
    return { toolCallId: normalizedToolCallId, validationError: TOOL_CALL_NOT_FOUND_ERROR };
  }

  const matchedByName = matchedById.filter(({ part: candidate }) => candidate.toolName === part.toolName);
  if (matchedByName.length === 0) {
    return { toolCallId: normalizedToolCallId, validationError: TOOL_NAME_MISMATCH_ERROR };
  }

  const runningMatches = matchedByName.filter(
    ({ part: candidate }) =>
      candidate.status === "running" || candidate.status === "awaiting_user",
  );
  if (runningMatches.length === 0) {
    return { toolCallId: normalizedToolCallId, validationError: TOOL_CALL_NOT_RUNNING_ERROR };
  }

  if (runningMatches.length > 1) {
    return { toolCallId: normalizedToolCallId, validationError: DUPLICATE_TOOL_CALL_ERROR };
  }

  return { index: runningMatches[0]?.index, toolCallId: normalizedToolCallId };
}

export function createToolResultPart(input: {
  output: unknown;
  status?: AgentRunStatus;
  toolCallId: string;
  toolName: string;
}): ToolResultPart {
  return {
    type: "tool-result",
    toolName: input.toolName,
    toolCallId: normalizeToolCallId(input.toolCallId),
    status: input.status ?? "completed",
    output: input.output,
    outputSummary: summarizeToolOutput(input.output),
  };
}

export function mergeToolResultPart(parts: AgentPart[], part: ToolResultPart): AgentPart[] {
  const resolved = resolveToolResultTarget(parts, part);
  if (typeof resolved.index !== "number") {
    return [
      ...parts,
      {
        ...part,
        toolCallId: resolved.toolCallId,
        validationError: resolved.validationError,
      },
    ];
  }

  const candidate = parts[resolved.index] as ToolCallPart;
  return [
    ...parts.slice(0, resolved.index),
    {
      ...candidate,
      toolCallId: resolved.toolCallId,
      status: part.status,
      output: part.output,
      outputSummary: part.outputSummary,
      validationError: undefined,
    },
    ...parts.slice(resolved.index + 1),
  ];
}
