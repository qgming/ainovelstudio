/**
 * 工作流步骤间消息的解析与传递。
 * - parseMessageEnvelope：从 step 输出文本中识别 messageType / payload
 * - extractStepMessage：综合考虑 outputMode（review_json）选择消息源
 * - getIncomingMessages：把 runtime.latestMessageByType 转成 step prompt 需要的数组形式
 */

import { parseWorkflowMessagePayload } from "./api";
import type { StepMessage, WorkflowRuntimeState } from "./runtimeTypes";
import type { WorkflowMessagePayload, WorkflowReviewResult } from "./types";

/** 解析 LLM 输出文本中的 message 信封，识别失败返回 null。 */
export function parseMessageEnvelope(text: string): StepMessage | null {
  const payload = parseWorkflowMessagePayload(text);
  if (!payload) return null;

  const candidateType =
    typeof payload.messageType === "string"
      ? payload.messageType.trim()
      : typeof payload.type === "string"
        ? payload.type.trim()
        : "";
  if (!candidateType) return null;

  const innerPayload = payload.payload;
  if (innerPayload && typeof innerPayload === "object" && !Array.isArray(innerPayload)) {
    return {
      messageType: candidateType,
      messageJson: innerPayload as WorkflowMessagePayload,
    };
  }

  // 兼容旧格式：把信封以外的字段视为 payload。
  const { messageType: _ignoredMessageType, type: _ignoredType, ...rest } = payload;
  return {
    messageType: candidateType,
    messageJson: Object.keys(rest).length > 0 ? rest : payload,
  };
}

/** 根据 outputMode 决定消息来源：review_json 时直接走结构化结果，否则尝试解析文本信封。 */
export function extractStepMessage(params: {
  outputMode: "text" | "review_json";
  resultText: string;
  reviewResultValue: WorkflowReviewResult | null;
}): StepMessage | null {
  const { outputMode, resultText, reviewResultValue } = params;
  if (outputMode === "review_json" && reviewResultValue) {
    return {
      messageType: "review_result",
      messageJson: reviewResultValue as unknown as WorkflowMessagePayload,
    };
  }
  return parseMessageEnvelope(resultText);
}

/** 把 runtime 内累积的最新消息映射成 step prompt 期望的数组结构。 */
export function getIncomingMessages(runtime: WorkflowRuntimeState) {
  return Array.from(runtime.latestMessageByType.entries()).map(([type, payload]) => ({
    type,
    payload,
  }));
}
