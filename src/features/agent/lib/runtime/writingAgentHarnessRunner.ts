// CP-C/CP-F：基于 AgentHarness 的写作 Agent 运行器。
//
// 产出与旧 runWritingAgentPi 相同的 AsyncGenerator<AgentPart> 契约，供 session.ts 切线。
// 与旧实现的关键区别：
// - 引擎从低层 runAgentLoop 换成 AgentHarness（自带 jsonl 会话持久化 + 队列 + on() 钩子）。
// - 历史不再每轮重注入：pi 持久会话（per-book .sessions/）已持有，故 prompt 只发本轮内容。
// - 控制流改用 harness 原生能力，模式策略统一从 ModeConfig 读：
//     · 续轮（writeProtocolRepair / autopilot 目标续轮）
//         → turn_end 调 modeConfig.loop.decideContinuation，continue 时 harness.followUp(prompt)
//           在同一 prompt() 流内续轮（pi 推荐方式，整个 prompt() Promise 不 resolve 直到目标完成）。
//     · 步数预算 → turn_end 计数，达 modeConfig.stepLimit 后不再续轮（软收敛），abort 仅作硬中止兜底。
//     · tool_call 审批 → harness.on("tool_call") 调 modeConfig.approval.decideToolCall。
// - 事件桥接仍复用 AgentEventAdapter（pi AgentEvent → AgentPart）。

import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import { logPromptDebug } from "../debug";
import { createAsyncQueue } from "../core/partQueue";
import type { AgentSessionEvent } from "../core/events";
import { getModeConfig } from "../modes";
import { getPlanningIntervention } from "../planning";
import { buildUserTurnContent } from "../promptContext";
import { AgentEventAdapter } from "../pi/eventAdapter";
import type { AgentPart } from "../types";
import { hasProviderConfig, type WritingRuntimeContext } from "../writingRuntimeContext";
import { createNovelHarness } from "./harnessSession";

export type RunWritingAgentHarnessOptions = {
  abortSignal: AbortSignal;
  emit: (event: AgentSessionEvent) => void;
  prompt: string;
  sessionId: string;
  toolContext: WritingRuntimeContext;
};

// 本轮 user 内容：物料上下文（手动选择/项目默认/规划状态展示）+ 用户 prompt。
// 运行时控制块（系统级可信元数据）已在 harnessSession 注入 systemPrompt，这里不再重复。
function buildTurnContent(prompt: string, context: WritingRuntimeContext): string {
  const planningIntervention = getPlanningIntervention(context.planningState, prompt);
  const materialContext = buildUserTurnContent({
    manualContext: context.manualContext,
    planningIntervention,
    planningState: context.planningState,
    projectContext: context.projectContext,
    workspaceRootPath: context.workspaceRootPath,
  });
  return [materialContext, prompt]
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 用 AgentHarness 驱动一次写作 turn，产出应用 AgentPart 流。
 */
export async function* runWritingAgentHarness({
  abortSignal,
  emit,
  prompt,
  sessionId,
  toolContext,
}: RunWritingAgentHarnessOptions): AsyncGenerator<AgentPart> {
  if (!hasProviderConfig(toolContext.providerConfig)) {
    yield { type: "text", text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。" };
    return;
  }

  // bookId(UUID) 为解析 key；workspaceRootPath(books/<书名>) 为展示串。
  const harness = await createNovelHarness({
    sessionId,
    bookId: toolContext.workspaceBookId ?? "",
    displayPath: toolContext.workspaceRootPath ?? "",
    prompt,
    toolContext,
    abortSignal,
  });

  const modeConfig = getModeConfig(toolContext.mode);
  const adapter = new AgentEventAdapter({ modelId: toolContext.providerConfig.model });
  const queue = createAsyncQueue<AgentPart>();

  const stepLimit = modeConfig.stepLimit;
  // 协议修复续轮的硬上限：即便模式持续返回 write_repair（例如模型始终不调用
  // yolo_control），也不能无限续轮烧 token。达到上限后停止续轮,让本轮自然收敛。
  const MAX_REPAIR_FOLLOWUPS = 3;
  let turnCount = 0;
  let repairCount = 0;
  // 累积「当前 turn」内产出的 AgentPart，用于续轮判定（text/reasoning/tool-call/tool-result）。
  let currentTurnParts: AgentPart[] = [];
  let failure: Error | null = null;

  const turnContent = buildTurnContent(prompt, toolContext);
  logPromptDebug({
    label: toolContext.debugLabel ?? "chat-turn",
    messages: [{ content: turnContent, role: "user" }],
    system: "",
  });

  // 外部 abortSignal（来自 WritingAgentSession，对接 UI 停止）→ 转发到 harness.abort()。
  const onAbort = () => {
    void harness.abort();
  };
  if (abortSignal.aborted) {
    onAbort();
  } else {
    abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  // tool_call 审批钩子：按模式策略放行/拦截（book 全放行；autopilot 仅拦高风险）。
  // 用 emitHook 派发（subscribe 收不到），故必须用 harness.on。
  const offToolCall = harness.on("tool_call", (event) => {
    const decision = modeConfig.approval.decideToolCall({
      toolName: event.toolName,
      input: event.input,
      modeContext: toolContext.modeContext as never,
    });
    return decision.block ? { block: true, reason: decision.reason } : undefined;
  });

  // 订阅 harness 事件流：AgentEvent 经 adapter 翻译为 parts/events，harness 自有事件按需处理。
  const unsubscribe = harness.subscribe((event: AgentHarnessEvent) => {
    const { parts, events } = adapter.adapt(event as never);
    for (const evt of events) {
      emit(evt);
      if (evt.type === "turn_start") {
        currentTurnParts = [];
      }
      if (evt.type === "turn_end") {
        turnCount += 1;
        if (evt.usage) {
          toolContext.onUsage?.(evt.usage);
        }
        if (evt.finishReason === "error") {
          // 模型调用失败：记录错误并停止续轮。不再 followUp,否则会对同一个失败的
          // provider 无限重试(autopilot stepLimit=null 时尤甚)。让 prompt() 自然
          // resolve,失败在 stream 结束后于 line 178 抛出。
          failure = new Error(evt.errorMessage ?? "模型调用失败。");
          continue;
        }
        if (abortSignal.aborted) continue;

        // 步数预算：达上限不再续轮（软收敛，让本轮自然 agent_end）；不主动打断运行中的 turn。
        if (stepLimit !== null && turnCount >= stepLimit) {
          continue;
        }

        // 续轮判定（pi 推荐方式）：continue 则注入 followUp，在同一 prompt() 流内续轮。
        const decision = modeConfig.loop.decideContinuation({
          turnCount,
          stepLimit,
          finishReason: evt.finishReason,
          turnParts: currentTurnParts,
          modeContext: toolContext.modeContext as never,
          enabledToolIds: toolContext.enabledToolIds,
          userPrompt: prompt,
          repairCount,
        });
        if (decision.kind === "continue" && decision.followUpPrompt) {
          // 协议修复续轮已达上限 → 不再续轮,防止模型始终不发控制信号时无限循环。
          if (decision.reason === "write_repair" && repairCount >= MAX_REPAIR_FOLLOWUPS) {
            continue;
          }
          if (decision.reason === "write_repair") repairCount += 1;
          void harness.followUp(decision.followUpPrompt);
        }
      }
    }
    for (const part of parts) {
      // 累积本轮判定需要的类型；text-delta 合并不计（turn_end 时已有完整 text part）。
      if (
        part.type === "text" ||
        part.type === "reasoning" ||
        part.type === "tool-call" ||
        part.type === "tool-result"
      ) {
        currentTurnParts.push(part);
      }
      queue.push(part);
    }
  });

  // 启动一次 prompt，等待 harness 回到 idle 后关闭队列。
  void harness
    .prompt(turnContent)
    .then(() => harness.waitForIdle())
    .then(() => queue.close())
    .catch((error) => queue.close(error instanceof Error ? error : new Error(String(error))))
    .finally(() => {
      offToolCall();
      unsubscribe();
      abortSignal.removeEventListener("abort", onAbort);
    });

  for await (const part of queue.stream()) {
    yield part;
  }

  if (failure && !abortSignal.aborted) {
    throw failure;
  }
}
