import { compactText, truncateText } from "./text";
import {
  MAX_COMPACT_MESSAGE_CHARS,
  MAX_HISTORY_SUMMARY_ITEMS,
  MAX_HISTORY_SUMMARY_PATHS,
  MAX_MODEL_MEMORY_CHARS,
  type HistorySummaryOptions,
  type SerializedHistoryMessage,
  type TaskMemory,
} from "./types";

export function estimateMessagesChars(messages: SerializedHistoryMessage[], currentUserContent: string) {
  return messages.reduce((total, message) => total + message.content.length, currentUserContent.length);
}

function splitIntoMemoryCandidates(content: string) {
  return content
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？.!?])/u))
    .map((item) => compactText(item))
    .filter(Boolean);
}

function isConstraintCandidate(value: string) {
  return /(必须|不要|禁止|优先|只保留|不得|避免|保持|限制|约束)/u.test(value);
}

function isFactCandidate(value: string) {
  return /(已|当前|主角|角色|设定|时间线|地点|目标|状态|结果|revision_brief|issues|pass|输出摘要)/u.test(value);
}

function dedupeItems(values: string[], limit: number, maxChars: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = compactText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(truncateText(normalized, maxChars));
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function buildTaskMemory(messages: SerializedHistoryMessage[]): TaskMemory {
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");

  return {
    userGoals: dedupeItems(
      userMessages.map((message) => message.content).slice(-MAX_HISTORY_SUMMARY_ITEMS),
      MAX_HISTORY_SUMMARY_ITEMS,
      MAX_COMPACT_MESSAGE_CHARS,
    ),
    progress: dedupeItems(
      assistantMessages.map((message) => message.content).slice(-MAX_HISTORY_SUMMARY_ITEMS),
      MAX_HISTORY_SUMMARY_ITEMS,
      MAX_COMPACT_MESSAGE_CHARS,
    ),
    facts: dedupeItems(
      assistantMessages.flatMap((message) =>
        splitIntoMemoryCandidates(message.content).filter((candidate) => isFactCandidate(candidate))
      ),
      MAX_HISTORY_SUMMARY_ITEMS,
      MAX_COMPACT_MESSAGE_CHARS,
    ),
    constraints: dedupeItems(
      messages.flatMap((message) =>
        splitIntoMemoryCandidates(message.content).filter((candidate) => isConstraintCandidate(candidate))
      ),
      MAX_HISTORY_SUMMARY_ITEMS,
      MAX_COMPACT_MESSAGE_CHARS,
    ),
    paths: dedupeItems(
      messages.flatMap((message) => message.paths),
      MAX_HISTORY_SUMMARY_PATHS,
      120,
    ),
    tools: dedupeItems(
      messages.flatMap((message) => message.tools),
      MAX_HISTORY_SUMMARY_PATHS,
      80,
    ),
  };
}

function buildRuleBasedHistorySummary(taskMemory: TaskMemory) {
  return [
    "# 任务记忆摘要",
    "较早历史已压缩为任务记忆，只保留继续执行最需要的目标、事实、约束与轨迹。",
    taskMemory.userGoals.length > 0
      ? ["## 当前目标", ...taskMemory.userGoals.map((item) => `- ${item}`)].join("\n")
      : null,
    taskMemory.progress.length > 0
      ? ["## 已有进展", ...taskMemory.progress.map((item) => `- ${item}`)].join("\n")
      : null,
    taskMemory.facts.length > 0
      ? ["## 已确认事实", ...taskMemory.facts.map((item) => `- ${item}`)].join("\n")
      : null,
    taskMemory.constraints.length > 0
      ? ["## 当前约束", ...taskMemory.constraints.map((item) => `- ${item}`)].join("\n")
      : null,
    taskMemory.paths.length > 0
      ? ["## 相关路径", ...taskMemory.paths.map((item) => `- ${item}`)].join("\n")
      : null,
    taskMemory.tools.length > 0
      ? `## 已用工具\n- ${taskMemory.tools.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildHybridHistorySummary(
  messages: SerializedHistoryMessage[],
  currentUserContent: string,
  summarizeHistory?: HistorySummaryOptions["summarizeHistory"],
) {
  const taskMemory = buildTaskMemory(messages);
  const ruleSummary = buildRuleBasedHistorySummary(taskMemory);

  if (!summarizeHistory) {
    return ruleSummary;
  }

  try {
    const modelSummary = compactText(
      (await summarizeHistory({
        compactHistory: messages,
        currentUserContent,
        taskMemory,
      })) ?? "",
    );

    if (!modelSummary) {
      return ruleSummary;
    }

    return [
      "# 任务记忆摘要",
      "较早历史已压缩为任务记忆；模型负责进一步浓缩，规则层负责保留稳定结构。",
      "## 模型压缩摘要",
      truncateText(modelSummary, MAX_MODEL_MEMORY_CHARS),
      ...buildRuleBasedHistorySummary(taskMemory)
        .split("\n\n")
        .filter((_, index) => index >= 2),
    ].join("\n\n");
  } catch {
    return ruleSummary;
  }
}
