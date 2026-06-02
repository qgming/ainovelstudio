// CP-C/CP-F：基于 AgentHarness 的写作 Agent 运行器。
//
// 产出与旧 runWritingAgentPi 相同的 AsyncGenerator<AgentPart> 契约，供 session.ts 切线。
// 与旧实现的关键区别：
// - 引擎从低层 runAgentLoop 换成 AgentHarness（自带 jsonl 会话持久化 + 队列 + on() 钩子）。
// - 历史不再每轮重注入：pi 持久会话（per-book .sessions/）已持有，故 prompt 只发本轮内容。
// - 控制流改用 harness 原生能力，模式策略统一从 ModeConfig 读：
//     · 续轮（goal 目标续轮）
//         → turn_end 调 modeConfig.loop.decideContinuation，continue 时 harness.followUp(prompt)
//           在同一 prompt() 流内续轮（pi 推荐方式，整个 prompt() Promise 不 resolve 直到目标完成）。
//     · 步数预算 → turn_end 计数，达 modeConfig.stepLimit 后不再续轮（软收敛），abort 仅作硬中止兜底。
//     · tool_call 审批 → harness.on("tool_call") 调 modeConfig.approval.decideToolCall。
// - 事件桥接仍复用 AgentEventAdapter（pi AgentEvent → AgentPart）。

import type { AgentHarness, AgentHarnessEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "@earendil-works/pi-agent-core";
import { logPromptDebug } from "../utils/debug";
import { createAsyncQueue } from "./partQueue";
import type { AgentSessionEvent } from "./events";
import { getModeConfig } from "../modes";
import { getPlanningIntervention } from "../modes/planning";
import { buildRuntimeControlBlock, buildUserTurnContent } from "../prompt-context";
import {
  applyGoalControl,
  applyGoalUsage,
  getGoalControlDataFromPart,
  markGoalBudgetLimitNotified,
  type GoalRuntimeState,
} from "../domain/goalControl";
import { AgentEventAdapter } from "../pi/eventAdapter";
import type { AgentPart, AgentUsage } from "../types";
import { hasProviderConfig, type WritingRuntimeContext } from "./writingRuntimeContext";
import { createNovelHarness } from "./harnessSession";
import { NOVEL_COMPACTION_INSTRUCTIONS } from "./compactBookSession";

export type RunWritingAgentHarnessOptions = {
  abortSignal: AbortSignal;
  emit: (event: AgentSessionEvent) => void;
  prompt: string;
  sessionId: string;
  toolContext: WritingRuntimeContext;
};

// 本轮 user 内容：物料上下文（手动选择/项目默认/规划状态展示）+ 用户 prompt。
// 运行时控制块（系统级可信元数据）改由 context 钩子注入 messages 层，这里不再重复。
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

// 运行时控制块注入标记：用于在 context 钩子里识别并剔除上一轮注入的旧块，
// 避免每次 LLM 请求都堆叠一条，导致 messages 越积越多。
const RUNTIME_CONTEXT_MARKER = "<runtime_context>";

function messageHasRuntimeContext(message: AgentMessage): boolean {
  if (message.role !== "user") return false;
  const { content } = message;
  if (typeof content === "string") return content.includes(RUNTIME_CONTEXT_MARKER);
  return content.some(
    (part) => part.type === "text" && part.text.includes(RUNTIME_CONTEXT_MARKER),
  );
}

// 构造一条「运行时上下文」user 消息。日期/workspace/planning 等每轮变化的可信元数据
// 走 messages 层而非 systemPrompt，保证 system 前缀稳定、命中 pi 的 prefix caching。
function buildRuntimeContextMessage(
  prompt: string,
  context: WritingRuntimeContext,
  goalState?: GoalRuntimeState,
): AgentMessage {
  const body = buildRuntimeControlBlock({
    planningIntervention: getPlanningIntervention(context.planningState, prompt),
    planningState: context.planningState,
    workspaceRootPath: context.workspaceRootPath,
  });
  const goalBlock = goalState
    ? [
        "<goal_runtime>",
        `status: ${goalState.status}`,
        `objective: ${goalState.objective}`,
        `goal_id: ${goalState.goalId}`,
        `tokens_used: ${goalState.usage.tokensUsed}`,
        `active_seconds: ${goalState.usage.activeSeconds}`,
        `token_budget: ${goalState.tokenBudget ?? "none"}`,
        goalState.lastControl ? `last_control: ${goalState.lastControl.action} - ${goalState.lastControl.reason}` : null,
        goalState.auditFailures.length ? `audit_failures: ${goalState.auditFailures.join("；")}` : null,
        goalState.blockedCount ? `blocked_count: ${goalState.blockedCount}/3` : null,
        "</goal_runtime>",
      ].filter(Boolean).join("\n")
    : "";
  const text = [RUNTIME_CONTEXT_MARKER, body, goalBlock, "</runtime_context>"].filter(Boolean).join("\n");
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 0,
  };
}

function findLatestGoalControl(parts: readonly AgentPart[]) {
  for (const part of [...parts].reverse()) {
    const data = getGoalControlDataFromPart(part);
    if (data) return data;
  }
  return null;
}

// 整轮（含所有续轮）结束、harness 回到 idle 后，按 pi 自带阈值判断是否压缩 pi 会话。
// 关键修复：旧实现压的是 app ChatEntry（仅 UI 渲染层），模型实际读的是 pi jsonl 会话，
// 二者不通——等于从不压缩真实上下文，长会话必然超窗。改用 pi 原生 harness.compact()，
// 它会摘要并截断 jsonl 会话本身，下一轮模型读到的就是压缩后的上下文。
// compact() 要求 idle，故只在 waitForIdle 之后调用；压缩失败不应让整轮失败，吞掉即可。
async function maybeCompactSession(
  harness: AgentHarness,
  latestUsage: AgentUsage | null,
  abortSignal: AbortSignal,
): Promise<void> {
  if (abortSignal.aborted || !latestUsage) return;
  const contextWindow = harness.getModel().contextWindow;
  if (!contextWindow || contextWindow <= 0) return;
  if (!shouldCompact(latestUsage.totalTokens, contextWindow, DEFAULT_COMPACTION_SETTINGS)) {
    return;
  }
  try {
    await harness.compact(NOVEL_COMPACTION_INSTRUCTIONS);
  } catch {
    // 压缩失败（如摘要模型调用出错）不阻断主流程，下一轮命中阈值会再次尝试。
  }
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
  // goal_control），也不能无限续轮烧 token。达到上限后停止续轮,让本轮自然收敛。
  const MAX_REPAIR_FOLLOWUPS = 3;
  let turnCount = 0;
  let repairCount = 0;
  let turnStartedAt: number | null = null;
  let goalState = toolContext.modeContext && "goalState" in toolContext.modeContext
    ? toolContext.modeContext.goalState
    : undefined;
  // 累积「当前 turn」内产出的 AgentPart，用于续轮判定（text/reasoning/tool-call/tool-result）。
  let currentTurnParts: AgentPart[] = [];
  let failure: Error | null = null;
  // 最近一次 turn 的 usage，整轮结束（idle）后用于判断是否需要压缩 pi 会话。
  let latestUsage: AgentUsage | null = null;

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

  // tool_call 审批钩子：按模式策略放行/拦截（book 全放行；goal 仅拦高风险）。
  // 用 emitHook 派发（subscribe 收不到），故必须用 harness.on。
  const offToolCall = harness.on("tool_call", (event) => {
    const decision = modeConfig.approval.decideToolCall({
      toolName: event.toolName,
      input: event.input,
      modeContext: toolContext.modeContext as never,
    });
    return decision.block ? { block: true, reason: decision.reason } : undefined;
  });

  // context 钩子（pi transformContext）：每次 LLM 请求前注入「运行时控制块」到 messages。
  // 这是把每轮变化的可信元数据（日期/workspace/planning）从 systemPrompt 下沉到 messages 层的关键，
  // 既保证 system 前缀稳定命中 prefix caching，又让模型每轮都看到最新运行时状态。
  // 注入位置：当前轮用户输入「之前」（即末尾倒数第二），让真实用户输入仍是最后一条消息，
  // 同时运行时块落在尾部非缓存区、不影响前缀命中。
  // 钩子不持久化返回的 messages（仅本次请求生效），故每次先剔除上一条注入再追加最新，避免堆叠。
  const offContext = harness.on("context", (event) => {
    const filtered = event.messages.filter((message) => !messageHasRuntimeContext(message));
    const runtimeMessage = buildRuntimeContextMessage(prompt, toolContext, goalState);
    // 找到最后一条 user（当前轮输入），把运行时块插在它前面；找不到则追加到尾部。
    let lastUserIndex = -1;
    for (let i = filtered.length - 1; i >= 0; i -= 1) {
      if (filtered[i]?.role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex >= 0) {
      filtered.splice(lastUserIndex, 0, runtimeMessage);
    } else {
      filtered.push(runtimeMessage);
    }
    return { messages: filtered };
  });

  // 订阅 harness 事件流：AgentEvent 经 adapter 翻译为 parts/events，harness 自有事件按需处理。
  const unsubscribe = harness.subscribe((event: AgentHarnessEvent) => {
    // pi 原生压缩事件桥接：harness.compact()（自动或手动触发）压缩 jsonl 会话后会 emit
    // session_compact，adapter 不认识它，这里翻译成 app 的 compaction_end，让 UI 追加压缩标记。
    if (event.type === "session_compact") {
      const entry = event.compactionEntry;
      emit({
        type: "compaction_end",
        aborted: false,
        reason: "threshold",
        summary: typeof entry?.summary === "string" ? entry.summary : undefined,
      });
      return;
    }

    const { parts, events } = adapter.adapt(event as never);
    for (const evt of events) {
      emit(evt);
      if (evt.type === "turn_start") {
        currentTurnParts = [];
        turnStartedAt = Date.now();
      }
      if (evt.type === "turn_end") {
        turnCount += 1;
        const activeSecondsDelta = turnStartedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - turnStartedAt) / 1000));
        turnStartedAt = null;
        if (evt.usage) {
          latestUsage = evt.usage;
          toolContext.onUsage?.(evt.usage);
        }
        if (evt.finishReason === "error") {
          // 模型调用失败：记录错误并停止续轮。不再 followUp,否则会对同一个失败的
          // provider 无限重试(goal stepLimit=null 时尤甚)。让 prompt() 自然
          // resolve,失败在 stream 结束后于 line 178 抛出。
          failure = new Error(evt.errorMessage ?? "模型调用失败。");
          continue;
        }
        if (abortSignal.aborted) continue;

        if (toolContext.mode === "goal" && goalState) {
          const turnUsage = evt.usage ?? latestUsage;
          const usageApplied = applyGoalUsage(
            goalState,
            turnUsage ? turnUsage.noCacheTokens + turnUsage.outputTokens : 0,
            activeSecondsDelta,
          );
          goalState = applyGoalControl(usageApplied.state, findLatestGoalControl(currentTurnParts));
          if (goalState.status === "budget_limited" && usageApplied.crossedBudget) {
            goalState = { ...goalState, budgetLimitNotified: false };
          }
          toolContext.onGoalStateChange?.(goalState);
        }

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
          goalState,
          latestUsage: evt.usage ?? latestUsage,
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
          if (decision.reason === "budget_limited" && goalState?.status === "budget_limited") {
            goalState = markGoalBudgetLimitNotified(goalState);
            toolContext.onGoalStateChange?.(goalState);
          }
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

  // 启动一次 prompt，等待 harness 回到 idle 后（必要时压缩 pi 会话）再关闭队列。
  void harness
    .prompt(turnContent)
    .then(() => harness.waitForIdle())
    .then(() => maybeCompactSession(harness, latestUsage, abortSignal))
    .then(() => queue.close())
    .catch((error) => queue.close(error instanceof Error ? error : new Error(String(error))))
    .finally(() => {
      offToolCall();
      offContext();
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
