import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMode } from "../modeRules";
import type { AgentPart } from "../types";
import { resolveAgentStepLimit } from "../core/stepLimits";
import { getWriteProtocolRepairPrompt, type WriteProtocolRepairConfig } from "../core/writeProtocolRepair";

// 把 pi AssistantMessage 的内容块转成 writeProtocolRepair 需要检查的最小 AgentPart 集合
// （它只看 text / reasoning / tool-call 的存在性与文本）。
function assistantContentToRepairParts(message: AssistantMessage): AgentPart[] {
  return message.content.flatMap<AgentPart>((block) => {
    if (block.type === "text") {
      return block.text.trim() ? [{ type: "text", text: block.text }] : [];
    }
    if (block.type === "thinking") {
      return block.thinking.trim() ? [{ type: "reasoning", summary: "", detail: block.thinking }] : [];
    }
    if (block.type === "toolCall") {
      return [
        {
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          status: "running",
          inputSummary: "",
        },
      ];
    }
    return [];
  });
}

function toUserMessage(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() } as AgentMessage;
}

export type AgentCallbacksOptions = {
  mode: AgentMode | undefined;
  writeProtocolRepair?: WriteProtocolRepairConfig;
  // 取出排队中的 steering / followUp 文本（来自 WritingAgentSession 的队列）。
  takeSteeringMessages?: () => string[];
  takeFollowUpMessages?: () => string[];
};

export type AgentCallbacks = {
  // pi AgentOptions / AgentLoopConfig 对应钩子
  prepareNextTurn: (context: { message: AgentMessage }) => undefined;
  shouldStopAfterTurn: () => boolean;
  getSteeringMessages: () => Promise<AgentMessage[]>;
  getFollowUpMessages: () => Promise<AgentMessage[]>;
};

/**
 * 把自研 loop.ts 的控制流（步数预算 / steering / followUp / writeProtocolRepair）
 * 映射成 pi Agent 的回调集合。
 *
 * 关键对齐（基于 pi agent-loop 的实际循环顺序，agent-loop.js:77-170）：
 * - getSteeringMessages：pi 在每个 assistant 轮（含工具）结束后调用 → 直接吐队列里的 steering。
 * - writeProtocolRepair：旧逻辑是"agent 本会停下、但要注入修复 prompt 继续"。pi 里这正是
 *   getFollowUpMessages 的语义（无工具调用、无 steering 时触发，返回消息则继续）。因此 repair
 *   与真实 followUp 合并到 getFollowUpMessages，repair 优先。
 * - prepareNextTurn：仅用来记录"上一轮的 assistant 消息"（repair 判断需要它），返回 undefined
 *   不改 context/model（pi 的 prepareNextTurn 不能注入消息，只能换 context/model/thinkingLevel）。
 * - shouldStopAfterTurn：承接步数预算（COLLAB 1000 / autopilot 不限）。
 */
export function buildAgentCallbacks(options: AgentCallbacksOptions): AgentCallbacks {
  const stepLimit = resolveAgentStepLimit(options.mode);
  let turnCount = 0;
  let lastAssistantMessage: AssistantMessage | null = null;
  let writeProtocolRepairCount = 0;

  return {
    prepareNextTurn({ message }) {
      turnCount += 1;
      if (message && (message as { role?: string }).role === "assistant") {
        lastAssistantMessage = message as AssistantMessage;
      }
      return undefined;
    },

    shouldStopAfterTurn() {
      if (stepLimit === null) return false; // autopilot 不限步数
      return turnCount >= stepLimit;
    },

    async getSteeringMessages() {
      const messages = options.takeSteeringMessages?.() ?? [];
      return messages.map(toUserMessage);
    },

    async getFollowUpMessages() {
      // 1. 先尝试 writeProtocolRepair（只在最近一轮是普通文本结束、且任务像写入任务时触发，单次）。
      if (lastAssistantMessage) {
        const finishReason = lastAssistantMessage.stopReason === "stop" ? "stop" : lastAssistantMessage.stopReason;
        const repairPrompt = getWriteProtocolRepairPrompt({
          config: options.writeProtocolRepair,
          finishReason,
          parts: assistantContentToRepairParts(lastAssistantMessage),
          repairCount: writeProtocolRepairCount,
        });
        if (repairPrompt) {
          writeProtocolRepairCount += 1;
          return [toUserMessage(repairPrompt)];
        }
      }

      // 2. 再吐真实排队的 followUp。
      const messages = options.takeFollowUpMessages?.() ?? [];
      return messages.map(toUserMessage);
    },
  };
}
