export const REASONING_EFFORT_OPTIONS = [
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number];
export type ExplicitReasoningEffort = Exclude<ReasoningEffort, "auto">;

const REASONING_EFFORT_SET = new Set<string>(REASONING_EFFORT_OPTIONS);

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORT_SET.has(value)
    ? (value as ReasoningEffort)
    : "auto";
}

export function isExplicitReasoningEffort(
  value: ReasoningEffort,
): value is ExplicitReasoningEffort {
  return value !== "auto";
}
