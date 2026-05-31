// CP-F：BOOK（图书工作区多轮协作）模式策略。

import { buildModeRules } from "../modeRules";
import { getWriteProtocolRepairPrompt } from "../core/writeProtocolRepair";
import { YOLO_CONTROL_TOOL_ID } from "../yoloControl";
import { filterEnabledToolIdsForMode } from "./toolFilter";
import type { ContinuationDecision, ContinuationInput, ModeConfig } from "./types";

/** 协作模式步数上限：足够长的多轮协作，超限主动收敛兜底。 */
export const COLLAB_STEP_LIMIT = 1000;

function decideContinuation(input: ContinuationInput<"book">): ContinuationDecision {
  // book 模式不做目标自动续轮，唯一的续轮是 writeProtocolRepair（单次）：
  // 本轮以普通文本结束、像写入任务却没调写入工具 → 注入修复 followUp。
  const repairPrompt = getWriteProtocolRepairPrompt({
    config: { enabledToolIds: input.enabledToolIds, userPrompt: input.userPrompt },
    finishReason: input.finishReason,
    parts: input.turnParts,
    repairCount: input.repairCount,
  });
  if (repairPrompt) {
    return { kind: "continue", followUpPrompt: repairPrompt, reason: "write_repair" };
  }
  return { kind: "stop" };
}

export const bookMode: ModeConfig<"book"> = {
  id: "book",
  tools: {
    // book 模式无控制工具，且要剔除 autopilot 专属的 yolo_control。
    requiredControlToolId: null,
    filterEnabledToolIds: (allEnabled) =>
      filterEnabledToolIdsForMode(allEnabled, null, [YOLO_CONTROL_TOOL_ID]),
  },
  stepLimit: COLLAB_STEP_LIMIT,
  buildRules: () => buildModeRules("book", {}),
  loop: { decideContinuation },
  // book 是与作者协作的开放模式，工具全部放行，不做 tool_call 审批。
  approval: { decideToolCall: () => ({ block: false }) },
};
