import type { AgentMessage, AgentMessageMeta, AgentPart, AgentRun, AgentRunStatus } from "../agent/types";
import { mergeToolResultPart } from "../agent/toolParts";
import type { ChatSessionPatch } from "./types";

const DEFAULT_TITLE = "新对话";

function nowEpoch() {
  return Math.floor(Date.now() / 1000).toString();
}

function truncateText(value: string, limit: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.length > limit ? `${trimmed.slice(0, limit).trim()}…` : trimmed;
}

function extractPartText(part: AgentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "reasoning":
      return [part.summary, part.detail].filter(Boolean).join(" ");
    case "tool-call":
      return [part.inputSummary, part.outputSummary].filter(Boolean).join(" ");
    case "tool-result":
      return part.outputSummary;
    case "subagent":
      return [part.summary, part.detail].filter(Boolean).join(" ");
    default:
      return "";
  }
}

function extractMessageText(message: AgentMessage) {
  return message.parts.map(extractPartText).join(" ").trim();
}

export function buildInitialRun(): AgentRun {
  return {
    id: "run-default",
    status: "idle",
    title: DEFAULT_TITLE,
    messages: [],
  };
}

export function buildRun(id: string, title: string, status: AgentRunStatus, messages: AgentMessage[]): AgentRun {
  return {
    id,
    status,
    title: title.trim() || DEFAULT_TITLE,
    messages,
  };
}

export function normalizeRecoveredStatus(status: AgentRunStatus): AgentRunStatus {
  return status === "running" || status === "awaiting_user" ? "idle" : status;
}

function normalizeRecoveredPart(part: AgentPart): AgentPart | null {
  if (part.type === "placeholder") {
    return null;
  }

  if (
    (part.type === "tool-call" || part.type === "tool-result")
    && (part.status === "running" || part.status === "awaiting_user")
  ) {
    return {
      ...part,
      status: "failed",
      outputSummary: part.outputSummary ?? "已中断",
    };
  }

  if (part.type === "ask-user") {
    if (part.status !== "awaiting_user") {
      return part;
    }

    return {
      ...part,
      status: "failed",
      errorMessage: part.errorMessage ?? "等待用户输入的交互已中断，请重新发起。",
    };
  }

  if (part.type === "subagent") {
    return {
      ...part,
      status: part.status === "running" ? "failed" : part.status,
      detail: part.status === "running"
        ? part.detail ?? "执行已中断。"
        : part.detail,
      parts: normalizeRecoveredMessageParts(part.parts),
    };
  }

  return part;
}

export function normalizeRecoveredMessageParts(parts: AgentPart[]) {
  return parts
    .map((part) => normalizeRecoveredPart(part))
    .filter((part): part is AgentPart => part !== null);
}

export function normalizeRecoveredMessages(messages: AgentMessage[]) {
  return messages
    .map((message) => ({
      ...message,
      parts: normalizeRecoveredMessageParts(message.parts),
    }))
    .filter((message) => message.parts.length > 0);
}

export function buildUserMessage(text: string, meta?: AgentMessageMeta): AgentMessage {
  return {
    id: `user-${Date.now()}`,
    role: "user",
    author: "你",
    meta,
    parts: [{ type: "text", text }],
  };
}

export function buildAssistantPlaceholderMessage(meta?: AgentMessageMeta): AgentMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: "assistant",
    author: "主代理",
    meta,
    parts: [{ type: "placeholder", text: "正在思考" }],
  };
}

export function buildSystemMessage(text: string, meta?: AgentMessageMeta): AgentMessage {
  return {
    id: `system-${Date.now()}`,
    role: "system",
    author: "系统",
    meta,
    parts: [{ type: "text", text }],
  };
}

export function buildMessageMeta(workspaceRootPath: string | null, activeFilePath: string | null): AgentMessageMeta {
  return {
    activeFilePath,
    workspaceRootPath,
  };
}

export function mergePart(parts: AgentPart[], part: AgentPart): AgentPart[] {
  const nextParts = parts[0]?.type === "placeholder" ? [] : parts;

  if (part.type === "text-delta") {
    const last = nextParts[nextParts.length - 1];
    if (last?.type === "text") {
      return [...nextParts.slice(0, -1), { ...last, text: last.text + part.delta }];
    }
    return [...nextParts, { type: "text", text: part.delta }];
  }

  if (part.type === "reasoning") {
    const last = nextParts[nextParts.length - 1];
    if (last?.type === "reasoning") {
      return [...nextParts.slice(0, -1), { ...last, detail: last.detail + part.detail }];
    }
    return [...nextParts, part];
  }

  if (part.type === "subagent") {
    const existingIndex = nextParts.findIndex(
      (candidate) => candidate.type === "subagent" && candidate.id === part.id,
    );
    if (existingIndex >= 0) {
      return nextParts.map((candidate, index) => (index === existingIndex ? { ...candidate, ...part } : candidate));
    }
    return [...nextParts, part];
  }

  if (part.type === "ask-user") {
    const withUpdatedToolCalls = nextParts.map((candidate) => {
      if (
        candidate.type !== "tool-call"
        || candidate.toolCallId !== part.toolCallId
        || candidate.toolName !== part.toolName
      ) {
        return candidate;
      }

      return {
        ...candidate,
        status:
          part.status === "awaiting_user"
            ? "awaiting_user"
            : candidate.status,
      };
    });
    const existingIndex = withUpdatedToolCalls.findIndex(
      (candidate) =>
        candidate.type === "ask-user"
        && candidate.toolCallId === part.toolCallId
        && candidate.toolName === part.toolName,
    );
    if (existingIndex >= 0) {
      return withUpdatedToolCalls.map((candidate, index) =>
        index === existingIndex ? { ...candidate, ...part } : candidate,
      );
    }
    return [...withUpdatedToolCalls, part];
  }

  if (part.type === "tool-result") {
    return mergeToolResultPart(nextParts, part);
  }

  return [...nextParts, part];
}

export function isPlaceholderOnly(message: AgentMessage) {
  return message.parts.length === 1 && message.parts[0]?.type === "placeholder";
}

export function deriveSessionTitle(messages: AgentMessage[]) {
  const firstUserText = messages.find((message) => message.role === "user");
  return truncateText(firstUserText ? extractMessageText(firstUserText) : DEFAULT_TITLE, 24) || DEFAULT_TITLE;
}

export function deriveSessionSummary(messages: AgentMessage[]) {
  const reversed = [...messages].reverse();
  for (const message of reversed) {
    const text = extractMessageText(message);
    if (text) {
      return truncateText(text, 56);
    }
  }
  return "";
}

export function buildSessionPatch(messages: AgentMessage[], status: AgentRunStatus): ChatSessionPatch {
  const timestamp = nowEpoch();
  return {
    title: deriveSessionTitle(messages),
    summary: deriveSessionSummary(messages),
    status,
    updatedAt: timestamp,
    lastMessageAt: messages.length > 0 ? timestamp : null,
  };
}

export function sortSessionSummaries<T extends { updatedAt: string; createdAt: string }>(sessions: T[]) {
  return [...sessions].sort((left, right) => {
    const updatedDiff = Number(right.updatedAt) - Number(left.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return Number(right.createdAt) - Number(left.createdAt);
  });
}
