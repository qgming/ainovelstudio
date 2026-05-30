import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

// pi 标准 LLM 消息的 role 集合。其余（应用通过 declaration merging 扩展的自定义消息，
// 如 ask_user 交互留痕）属于 UI-only，不应进入 LLM 请求。
const LLM_ROLES = new Set(["user", "assistant", "toolResult"]);

function isLlmMessage(message: AgentMessage): message is Message {
  return typeof (message as { role?: unknown }).role === "string" && LLM_ROLES.has((message as { role: string }).role);
}

/**
 * pi Agent 的 convertToLlm：把会话内部的 AgentMessage[] 转成 LLM 可理解的 Message[]。
 *
 * 职责（pi 契约要求）：过滤 UI-only/自定义消息，转换可转换的消息。
 * 本应用约定：
 * - user / assistant / toolResult 三类标准 pi-ai 消息原样透传（已是目标格式）。
 * - 其余自定义消息（ask_user 交互记录等）过滤掉——它们仅用于 UI 呈现与审计，
 *   ask_user 的答案已经通过 toolResult 进入了 LLM 上下文，无需重复。
 *
 * 契约：不得抛错。无法转换的消息直接过滤。
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(isLlmMessage);
}
