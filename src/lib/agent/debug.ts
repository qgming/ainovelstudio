/**
 * Agent 运行时的调试与系统消息辅助。
 * - createSystemMessage：构造 system 角色的 AgentMessage（保留旧 export 兼容）。
 * - logPromptDebug：折叠输出 system + messages 便于排查 prompt。
 */

import type { AgentMessage } from "./types";

/** 构造一条系统消息（用于将上下文以系统通知形式插入到对话流）。 */
export function createSystemMessage(text: string): AgentMessage {
  return {
    id: `system-${Date.now()}`,
    role: "system",
    author: "系统",
    parts: [{ type: "text", text }],
  };
}

export type DebuggableMessage = {
  content: string;
  role: string;
};

/** 把任意类型的消息内容标准化为字符串以便打印。 */
export function normalizeDebugMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/** 折叠输出本轮 prompt 的 system + messages，便于在 DevTools 中排查。 */
export function logPromptDebug(params: {
  label: string;
  messages: DebuggableMessage[];
  system: string;
}): void {
  const { label, messages, system } = params;
  const header = `[Prompt Debug] ${label}`;
  const groupLabel =
    typeof console.groupCollapsed === "function" ? console.groupCollapsed : console.log;
  const groupEnd = typeof console.groupEnd === "function" ? console.groupEnd : null;

  groupLabel(header);
  console.log("System Prompt:");
  console.log(system);
  messages.forEach((message, index) => {
    console.log(`Message ${index + 1} [${message.role}]:`);
    console.log(message.content);
  });
  groupEnd?.();
}
