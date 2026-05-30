import { runAgentLoop, type AgentContext, type AgentMessage as PiAgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { logPromptDebug, normalizeDebugMessageContent } from "../debug";
import { generateAgentObject } from "../modelGateway";
import { buildLinearConversationMessages } from "../linearConversationContext";
import type { HistorySummaryOptions } from "../messageContext";
import { getPlanningIntervention } from "../planning";
import { buildRuntimeControlBlock, buildSystemPrompt, buildUserTurnContent } from "../promptContext";
import { createAsyncQueue } from "../core/partQueue";
import type { AgentSessionEvent } from "../core/events";
import type { AgentPart } from "../types";
import { hasProviderConfig, type WritingRuntimeContext } from "../writingRuntimeContext";
import { toPiModel, toPiThinkingLevel } from "./models";
import { buildPiTools } from "./buildPiTools";
import { convertToLlm } from "./convertToLlm";
import { buildAgentCallbacks } from "./agentCallbacks";
import { AgentEventAdapter } from "./eventAdapter";
import { modelMessagesToPi } from "./modelMessagesToPi";

export type RunWritingAgentPiOptions = {
  abortSignal: AbortSignal;
  emit: (event: AgentSessionEvent) => void;
  prompt: string;
  takeFollowUpMessages: () => string[];
  takeSteeringMessages: () => string[];
  toolContext: WritingRuntimeContext;
};

const historySummaryOutputSchema = Type.Object({
  summary: Type.String({ description: "压缩后的任务记忆摘要。" }),
});

// 记忆压缩：把任务记忆压成高密度摘要（沿用旧逻辑，仅生成走 pi gateway）。
function buildHistorySummaryFn(
  providerConfig: WritingRuntimeContext["providerConfig"],
): NonNullable<HistorySummaryOptions["summarizeHistory"]> {
  return async ({ currentUserContent, taskMemory }) => {
    const memoryLines = [
      taskMemory.userGoals.length ? `当前目标：${taskMemory.userGoals.join(" | ")}` : null,
      taskMemory.progress.length ? `已有进展：${taskMemory.progress.join(" | ")}` : null,
      taskMemory.facts.length ? `已确认事实：${taskMemory.facts.join(" | ")}` : null,
      taskMemory.constraints.length ? `当前约束：${taskMemory.constraints.join(" | ")}` : null,
      taskMemory.paths.length ? `相关路径：${taskMemory.paths.join(" | ")}` : null,
      taskMemory.tools.length ? `已用工具：${taskMemory.tools.join(", ")}` : null,
    ].filter(Boolean).join("\n");

    const output = await generateAgentObject({
      schema: historySummaryOutputSchema,
      toolName: "history_summary",
      toolDescription: "当前任务继续执行所需的高密度会话记忆摘要。",
      prompt: [
        "请把下面的会话任务记忆压缩成一段高密度摘要。",
        "只保留继续当前任务真正需要的信息，优先保留目标、事实、约束、相关文件和下一步。",
        "使用简体中文，控制在 180 字以内。",
        "",
        `当前用户请求：${currentUserContent}`,
        "",
        memoryLines,
      ].join("\n"),
      providerConfig,
      system: "你是任务记忆压缩器。只输出一段精炼摘要。",
    });
    return output.summary;
  };
}

function buildPromptPieces(prompt: string, context: WritingRuntimeContext) {
  const planningIntervention = getPlanningIntervention(context.planningState, prompt);
  const runtimeControl = buildRuntimeControlBlock({
    planningIntervention,
    planningState: context.planningState,
    workspaceRootPath: context.workspaceRootPath,
  });
  const materialContext = buildUserTurnContent({
    manualContext: context.manualContext,
    planningIntervention,
    planningState: context.planningState,
    projectContext: context.projectContext,
    workspaceRootPath: context.workspaceRootPath,
  });
  return { materialContext, runtimeControl };
}

// 组装 systemPrompt + 历史 messages + 当前 turn 的 prompt 文本。
async function buildSessionContext(prompt: string, context: WritingRuntimeContext) {
  const { materialContext, runtimeControl } = buildPromptPieces(prompt, context);
  const system = [
    buildSystemPrompt({
      defaultAgentMarkdown: context.defaultAgentMarkdown,
      enabledSkills: context.enabledSkills,
      enabledToolIds: context.enabledToolIds,
      mode: context.mode,
      modeContext: context.modeContext,
    }),
    runtimeControl,
  ].filter((section) => section.trim()).join("\n\n");

  // 历史消息（不含当前 turn 的 prompt），转成 pi Message 作为 loop context.messages。
  const historyModelMessages = await buildLinearConversationMessages({
    entries: context.conversationEntries as never,
    history: context.conversationHistory,
    currentUserContent: [],
    summaryOptions: { summarizeHistory: buildHistorySummaryFn(context.providerConfig) },
  });
  const historyMessages = modelMessagesToPi(historyModelMessages);

  // 当前 turn 的内容：物料上下文 + 用户 prompt。
  const currentTurnContent = [materialContext, prompt].map((s) => s.trim()).filter(Boolean).join("\n\n");

  logPromptDebug({
    label: context.debugLabel ?? "chat-turn",
    messages: [
      ...historyModelMessages.map((message) => ({
        content: normalizeDebugMessageContent(message.content),
        role: message.role,
      })),
      { content: currentTurnContent, role: "user" },
    ],
    system,
  });

  return { system, historyMessages, currentTurnContent };
}

/**
 * 用 pi-agent-core 的低层 runAgentLoop 驱动一次写作 turn，产出应用的 AgentPart 流。
 * 替代旧 runWritingAgent（自研 agentLoop + AI SDK）。
 *
 * 为什么用 runAgentLoop 而非高层 Agent 类：Agent 类只暴露 steer/followUp 队列，
 * 不接受 shouldStopAfterTurn（步数预算）和上下文感知的 getSteeringMessages/getFollowUpMessages
 * （writeProtocolRepair 需要按 finishReason 注入）。runAgentLoop 接受完整 AgentLoopConfig，
 * 正好承接 buildAgentCallbacks 的全部控制流。
 *
 * 事件桥接：runAgentLoop 的 emit 回调把 AgentEvent 经 AgentEventAdapter 翻译成 AgentPart 推进
 * createAsyncQueue，再以 AsyncGenerator 形式吐出。
 */
export async function* runWritingAgentPi({
  abortSignal,
  emit,
  prompt,
  takeFollowUpMessages,
  takeSteeringMessages,
  toolContext,
}: RunWritingAgentPiOptions): AsyncGenerator<AgentPart> {
  if (!hasProviderConfig(toolContext.providerConfig)) {
    yield { type: "text", text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。" };
    return;
  }

  const { system, historyMessages, currentTurnContent } = await buildSessionContext(prompt, toolContext);

  const tools = buildPiTools({
    workspaceTools: toolContext.workspaceTools,
    enabledToolIds: toolContext.enabledToolIds,
    abortSignal,
    onToolRequestStateChange: toolContext.onToolRequestStateChange,
    onAskUser: toolContext.onAskUser,
  });

  const callbacks = buildAgentCallbacks({
    mode: toolContext.mode,
    writeProtocolRepair: { enabledToolIds: toolContext.enabledToolIds, userPrompt: prompt },
    takeSteeringMessages,
    takeFollowUpMessages,
  });

  const model = toPiModel(toolContext.providerConfig);
  const thinkingLevel = toPiThinkingLevel(toolContext.providerConfig);
  const adapter = new AgentEventAdapter({ modelId: toolContext.providerConfig.model });
  const queue = createAsyncQueue<AgentPart>();
  // provider 失败时 pi 以 stopReason='error' 优雅收尾（resolve 而非 reject），turn 会静默结束。
  // 这里在 sink 捕获失败的 turn_end，待队列耗尽后抛出，复用 drainPrompt→handleFailure 的错误透出链路。
  let failure: Error | null = null;

  const context: AgentContext = {
    systemPrompt: system,
    messages: historyMessages,
    tools,
  };

  const promptMessage: PiAgentMessage = { role: "user", content: currentTurnContent, timestamp: Date.now() };

  // 把 AgentEvent 翻译并分发：events→emit（含 usage），parts→queue。
  const sink = (event: Parameters<Parameters<typeof runAgentLoop>[3]>[0]) => {
    const { parts, events } = adapter.adapt(event);
    for (const evt of events) {
      emit(evt);
      if (evt.type === "turn_end" && evt.usage) {
        toolContext.onUsage?.(evt.usage);
      }
      // provider 失败的 turn（finishReason='error'）记下错误，待生成器收尾时抛出。
      // 'aborted' 不在此处理：用户主动中止由 abortSignal + 终端层 isExplicitRunInterrupt 负责。
      if (evt.type === "turn_end" && evt.finishReason === "error") {
        failure = new Error(evt.errorMessage ?? "模型调用失败。");
      }
    }
    for (const part of parts) {
      queue.push(part);
    }
  };

  // 启动 pi run，结束后关闭队列。
  void runAgentLoop(
    [promptMessage],
    context,
    {
      model,
      reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
      apiKey: toolContext.providerConfig.apiKey.trim(),
      convertToLlm,
      getApiKey: () => toolContext.providerConfig.apiKey.trim(),
      shouldStopAfterTurn: () => callbacks.shouldStopAfterTurn(),
      prepareNextTurn: (ctx) => {
        // 记录最近 assistant 消息（writeProtocolRepair 判断需要），不改 context/model。
        callbacks.prepareNextTurn({ message: ctx.message });
        return undefined;
      },
      getSteeringMessages: () => callbacks.getSteeringMessages(),
      getFollowUpMessages: () => callbacks.getFollowUpMessages(),
    },
    sink,
    abortSignal,
    toolContext.streamFn,
  )
    .then(() => queue.close())
    .catch((error) => queue.close(error));

  for await (const part of queue.stream()) {
    yield part;
  }

  // 队列耗尽后，若本次 run 内有 provider 失败的 turn 且非用户主动中止，则抛出，
  // 经 drainPrompt 的 output.close(error) 透出到终端层 handleFailure 呈现错误消息。
  if (failure && !abortSignal.aborted) {
    throw failure;
  }
}
