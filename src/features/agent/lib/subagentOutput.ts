import type { AgentPart } from "./types";

export const MAX_SUBAGENT_MODEL_RESULT_CHARS = 6_000;
export const MAX_SUBAGENT_UI_DETAIL_CHARS = 12_000;
export const MAX_SUBAGENT_PART_TEXT_CHARS = 8_000;
export const MAX_SUBAGENT_SNAPSHOT_PARTS = 20;
export const MAX_TOOL_OUTPUT_SUMMARY_CHARS = 6_000;

export type TruncatedText = {
  originalChars: number;
  text: string;
  truncated: boolean;
};

export function truncateTextWithMeta(value: string, maxChars: number): TruncatedText {
  const originalChars = value.length;
  if (value.length <= maxChars) {
    return { originalChars, text: value, truncated: false };
  }

  return {
    originalChars,
    text: `${value.slice(0, maxChars).trimEnd()}\n\n[内容已截断：原始 ${originalChars} 字符，仅保留前 ${maxChars} 字符。]`,
    truncated: true,
  };
}

function limitText(value: string | undefined, maxChars = MAX_SUBAGENT_PART_TEXT_CHARS) {
  if (!value) return value;
  return truncateTextWithMeta(value, maxChars).text;
}

export function compactSubagentSnapshotParts(parts: AgentPart[]) {
  const recentParts = parts.slice(-MAX_SUBAGENT_SNAPSHOT_PARTS);
  return recentParts.map((part): AgentPart => {
    if (part.type === "text") {
      return { ...part, text: limitText(part.text) ?? "" };
    }
    if (part.type === "text-delta") {
      return { ...part, delta: limitText(part.delta) ?? "" };
    }
    if (part.type === "reasoning") {
      return { ...part, detail: limitText(part.detail) ?? "" };
    }
    if (part.type === "tool-call") {
      return {
        ...part,
        inputSummary: limitText(part.inputSummary, MAX_TOOL_OUTPUT_SUMMARY_CHARS) ?? "",
        output: undefined,
        outputSummary: limitText(part.outputSummary, MAX_TOOL_OUTPUT_SUMMARY_CHARS),
      };
    }
    if (part.type === "tool-result") {
      return {
        ...part,
        output: undefined,
        outputSummary: limitText(part.outputSummary, MAX_TOOL_OUTPUT_SUMMARY_CHARS) ?? "",
      };
    }
    if (part.type === "subagent") {
      return {
        ...part,
        detail: limitText(part.detail, MAX_SUBAGENT_UI_DETAIL_CHARS),
        parts: compactSubagentSnapshotParts(part.parts),
      };
    }
    return part;
  });
}
