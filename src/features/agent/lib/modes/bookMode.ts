// BOOK（图书工作区多轮协作）模式策略。

import { GOAL_CONTROL_TOOL_ID } from "../domain/goalControl";
import { filterEnabledToolIdsForMode } from "./toolFilter";
import type { ContinuationDecision, ContinuationInput, ModeConfig } from "./types";

/** 协作模式步数上限：足够长的多轮协作，超限主动收敛兜底。 */
export const COLLAB_STEP_LIMIT = 1000;

function decideContinuation(input: ContinuationInput<"book">): ContinuationDecision {
  void input;
  return { kind: "stop" };
}

export const bookMode: ModeConfig<"book"> = {
  id: "book",
  tools: {
    // book 模式无控制工具，且要剔除 goal 专属的 goal_control。
    requiredControlToolId: null,
    filterEnabledToolIds: (allEnabled) =>
      filterEnabledToolIdsForMode(allEnabled, null, [GOAL_CONTROL_TOOL_ID]),
  },
  stepLimit: COLLAB_STEP_LIMIT,
  loop: { decideContinuation },
  // book 是与作者协作的开放编辑模式，工具全部放行，不做目标模板检查或 tool_call 审批。
  approval: { decideToolCall: () => ({ block: false }) },
};
