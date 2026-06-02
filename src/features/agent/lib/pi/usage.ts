import type { AssistantMessage, StopReason, Usage } from "@earendil-works/pi-ai";
import type { AgentUsage } from "../types";

// 把 pi-ai 的 StopReason 映射成应用一直使用的 finishReason 字符串。
// 旧引擎里 finishReason 取自 AI SDK（"stop"/"tool-calls"/"length" 等），
// 这里把 pi 的 toolUse 归一成 "tool-calls" 以保持下游 steering 判断语义一致。
export function mapStopReasonToFinishReason(stopReason: StopReason): string {
  switch (stopReason) {
    case "toolUse":
      return "tool-calls";
    case "length":
      return "length";
    case "stop":
      return "stop";
    case "error":
      return "error";
    case "aborted":
      return "aborted";
    default:
      return stopReason;
  }
}

// 把 pi-ai 的 Usage 映射成应用的 AgentUsage。
// 缺口（pi Usage 无对应字段）：
// - noCacheTokens：pi 无细分，按 input - cacheRead 推算（与旧 AI SDK 的 inputTokenDetails.noCacheTokens 近似）。
// - reasoningTokens：pi Usage 无推理 token 细分，置 0。
export function toAgentUsage(params: {
  usage: Usage;
  modelId: string;
  finishReason: string;
  provider?: string;
}): AgentUsage {
  const { usage, modelId, finishReason } = params;
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const totalTokens = usage.totalTokens ?? input + output;

  return {
    recordedAt: Math.floor(Date.now() / 1000).toString(),
    provider: params.provider ?? "ainovelstudio-provider",
    modelId,
    finishReason,
    inputTokens: input,
    outputTokens: output,
    totalTokens,
    noCacheTokens: Math.max(0, input - cacheRead),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: 0,
  };
}

// 从一条 pi AssistantMessage 直接产出 AgentUsage（turn_end/message_end 场景的便捷封装）。
export function assistantMessageToAgentUsage(message: AssistantMessage, modelId: string): AgentUsage {
  return toAgentUsage({
    usage: message.usage,
    modelId,
    finishReason: mapStopReasonToFinishReason(message.stopReason),
    provider: message.provider,
  });
}

// 把多个 turn 的 AgentUsage 累加成一条会话级用量。
// token 字段逐项相加；finishReason/recordedAt/provider/modelId 取最新一次（next）。
// 背景：一条 assistant 消息可能跨多个 LLM turn（含工具调用），每个 turn_end 都会上报一次用量，
// 下游 buildUsagePatch 是整体替换 meta.usage，若不累加则只会保留最后一个 turn 的 token。
export function sumUsage(acc: AgentUsage | null, next: AgentUsage): AgentUsage {
  if (!acc) {
    return next;
  }
  return {
    recordedAt: next.recordedAt,
    provider: next.provider,
    modelId: next.modelId,
    finishReason: next.finishReason,
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
    noCacheTokens: acc.noCacheTokens + next.noCacheTokens,
    cacheReadTokens: acc.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + next.cacheWriteTokens,
    reasoningTokens: acc.reasoningTokens + next.reasoningTokens,
  };
}
