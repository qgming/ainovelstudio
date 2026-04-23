import type {
  WorkflowMessagePayload,
  WorkflowReviewResult,
} from "./types";

const DEFAULT_WORKFLOW_CONTEXT_BUDGET = 3_200;
const PREVIOUS_RESULT_BUDGET = 1_200;
const REVIEW_RESULT_BUDGET = 900;
const MESSAGE_TOTAL_BUDGET = 1_100;
const MESSAGE_ITEM_BUDGET = 320;

export type WorkflowMemoryMessage = {
  payload: WorkflowMessagePayload;
  type: string;
};

function truncateMiddle(value: string, maxChars: number) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  if (maxChars < 240) {
    return `${normalized.slice(0, maxChars).trimEnd()}…`;
  }

  const headChars = Math.max(Math.floor(maxChars * 0.72), maxChars - 180);
  const tailChars = Math.max(maxChars - headChars, 80);
  return [
    normalized.slice(0, headChars).trimEnd(),
    "…（中间省略）…",
    normalized.slice(-tailChars).trimStart(),
  ].join("\n");
}

function compactJson(value: unknown, maxChars: number) {
  try {
    return truncateMiddle(JSON.stringify(value), maxChars);
  } catch {
    return "";
  }
}

function formatPreviousContext(params: {
  previousMessage?: WorkflowMemoryMessage | null;
  previousResult?: string | null;
}) {
  const { previousMessage, previousResult } = params;
  if (previousMessage) {
    return `## 上一步交接\n- ${previousMessage.type}: ${compactJson(previousMessage.payload, PREVIOUS_RESULT_BUDGET)}`;
  }

  if (!previousResult?.trim()) {
    return "";
  }

  return `## 上一步交接\n${truncateMiddle(previousResult, PREVIOUS_RESULT_BUDGET)}`;
}

function formatReviewResult(reviewResult: WorkflowReviewResult, maxChars: number) {
  const issueSummary = reviewResult.issues
    .slice(0, 4)
    .map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.type}: ${issue.message}`)
    .join("\n");

  return truncateMiddle([
    `- pass: ${reviewResult.pass}`,
    reviewResult.revision_brief.trim()
      ? `- revision_brief: ${reviewResult.revision_brief.trim()}`
      : null,
    issueSummary ? "- issues:\n" + issueSummary : null,
  ].filter(Boolean).join("\n"), maxChars);
}

function formatIncomingMessages(messages: WorkflowMemoryMessage[]) {
  if (messages.length === 0) {
    return "";
  }

  return messages
    .map((message) => `- ${message.type}: ${compactJson(message.payload, MESSAGE_ITEM_BUDGET)}`)
    .filter(Boolean)
    .join("\n");
}

function prioritizeMessages(messages: WorkflowMemoryMessage[]) {
  const priorityMap: Record<string, number> = {
    revision_brief: 0,
    review_result: 1,
    scene_plan: 2,
    lore_update_summary: 3,
  };

  return [...messages].sort((left, right) =>
    (priorityMap[left.type] ?? 99) - (priorityMap[right.type] ?? 99)
    || left.type.localeCompare(right.type),
  );
}

function fitSection(remainingBudget: number, content: string) {
  if (!content.trim() || remainingBudget <= 0) {
    return "";
  }

  return truncateMiddle(content, remainingBudget);
}

function serializeMessage(message: WorkflowMemoryMessage) {
  try {
    return `${message.type}:${JSON.stringify(message.payload)}`;
  } catch {
    return `${message.type}:__unserializable__`;
  }
}

function dedupeIncomingMessages(params: {
  incomingMessages: WorkflowMemoryMessage[];
  previousMessage?: WorkflowMemoryMessage | null;
  reviewResult?: WorkflowReviewResult | null;
}) {
  const { incomingMessages, previousMessage, reviewResult } = params;
  const previousSignature = previousMessage ? serializeMessage(previousMessage) : null;
  const seen = new Set<string>();

  return incomingMessages.filter((message) => {
    if (reviewResult && (message.type === "review_result" || message.type === "revision_brief")) {
      return false;
    }

    const signature = serializeMessage(message);
    if (previousSignature && signature === previousSignature) {
      return false;
    }
    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

export function buildWorkflowDeltaMemory(params: {
  incomingMessages?: WorkflowMemoryMessage[];
  maxChars?: number;
  previousMessage?: WorkflowMemoryMessage | null;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
}) {
  const {
    incomingMessages = [],
    maxChars = DEFAULT_WORKFLOW_CONTEXT_BUDGET,
    previousMessage,
    previousResult,
    reviewResult,
  } = params;

  const sections: string[] = [];
  let remainingBudget = Math.max(maxChars, 600);
  const filteredMessages = dedupeIncomingMessages({
    incomingMessages,
    previousMessage,
    reviewResult,
  });

  const previousBlock = fitSection(
    Math.min(remainingBudget, PREVIOUS_RESULT_BUDGET),
    formatPreviousContext({ previousMessage, previousResult }),
  );
  if (previousBlock) {
    sections.push(previousBlock);
    remainingBudget -= previousBlock.length;
  }

  const reviewBlock = reviewResult
    ? fitSection(
        Math.min(remainingBudget, REVIEW_RESULT_BUDGET),
        `## 返修与审查增量\n${formatReviewResult(reviewResult, REVIEW_RESULT_BUDGET)}`,
      )
    : "";
  if (reviewBlock) {
    sections.push(reviewBlock);
    remainingBudget -= reviewBlock.length;
  }

  const structuredMessages = formatIncomingMessages(prioritizeMessages(filteredMessages));
  const messageBlock = structuredMessages
    ? fitSection(
        Math.min(remainingBudget, MESSAGE_TOTAL_BUDGET),
        `## 结构化协作增量\n${truncateMiddle(structuredMessages, MESSAGE_TOTAL_BUDGET)}`,
      )
    : "";
  if (messageBlock) {
    sections.push(messageBlock);
    remainingBudget -= messageBlock.length;
  }

  return {
    remainingChars: Math.max(remainingBudget, 0),
    text: sections.join("\n\n"),
    usedChars: sections.reduce((total, section) => total + section.length, 0),
  };
}
