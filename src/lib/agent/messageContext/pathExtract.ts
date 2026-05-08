import type { AgentPart } from "../types";

function tryParseJson(text: string) {
  const normalized = text.trim();
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

function collectPathLikeStrings(value: unknown, bucket: Set<string>, depth = 0) {
  if (depth > 3 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (/[\\/]/.test(normalized) && normalized.length <= 180) {
      bucket.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPathLikeStrings(entry, bucket, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  Object.entries(value).forEach(([key, candidate]) => {
    if (typeof candidate === "string" && /path$/i.test(key) && candidate.trim()) {
      bucket.add(candidate.trim());
      return;
    }

    collectPathLikeStrings(candidate, bucket, depth + 1);
  });
}

export function extractPathsFromToolPart(part: Extract<AgentPart, { type: "tool-call" | "tool-result" }>) {
  const paths = new Set<string>();
  const parsedInput = "inputSummary" in part ? tryParseJson(part.inputSummary) : null;
  const outputSummary = "outputSummary" in part ? part.outputSummary ?? "" : "";
  const parsedOutput = outputSummary ? tryParseJson(outputSummary) : null;

  if (parsedInput) {
    collectPathLikeStrings(parsedInput, paths);
  }
  if (parsedOutput) {
    collectPathLikeStrings(parsedOutput, paths);
  }

  return Array.from(paths);
}
