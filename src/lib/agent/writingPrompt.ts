import type { ToolSet } from "ai";
import { buildAiSdkTools } from "./buildAiSdkTools";
import { logPromptDebug, normalizeDebugMessageContent } from "./debug";
import { generateAgentText, streamAgentText } from "./modelGateway";
import { buildLinearConversationMessages } from "./linearContext";
import type { HistorySummaryOptions } from "./messageContext";
import { getPlanningIntervention } from "./planning";
import { buildSystemPrompt, buildUserTurnContent } from "./promptContext";
import { throwIfAborted } from "./asyncUtils";
import { agentLoop } from "./core/loop";
import { createAsyncQueue } from "./core/partQueue";
import { createScopedAskUser } from "./askRuntime";
import { createTaskTool } from "./taskTool";
import type { AgentSessionEvent } from "./core/events";
import type { AgentPart } from "./types";
import { hasProviderConfig, type WritingToolContext } from "./writingToolContext";

type RunWritingPromptOptions = {
  abortSignal?: AbortSignal;
  emit?: (event: AgentSessionEvent) => void;
  prompt: string;
  takeFollowUpMessages?: () => string[];
  takeSteeringMessages?: () => string[];
  toolContext: WritingToolContext;
};

function buildHistorySummaryFn(
  providerConfig: WritingToolContext["providerConfig"],
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

    return generateAgentText({
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
  };
}

function buildPromptContent(prompt: string, context: WritingToolContext) {
  const planningIntervention = getPlanningIntervention(context.planningState, prompt);
  return buildUserTurnContent({
    activeFilePath: context.activeFilePath,
    manualContext: context.manualContext,
    planningIntervention,
    planningState: context.planningState,
    projectContext: context.projectContext,
    workspaceRootPath: context.workspaceRootPath,
    prompt,
    subagentAnalysis: null,
  });
}

function buildTools(
  context: WritingToolContext,
  abortSignal: AbortSignal | undefined,
  enqueuePart: (part: AgentPart) => void,
): ToolSet {
  const askUser = createScopedAskUser({ abortSignal, enqueuePart, onAskUser: context.onAskUser });
  const aiTools = buildAiSdkTools(
    context.workspaceTools,
    context.enabledToolIds,
    abortSignal,
    context.onToolRequestStateChange,
    { askUser },
  );

  if (context.enabledToolIds.includes("task")) {
    aiTools.task = createTaskTool({
      abortSignal,
      enabledSkills: context.enabledSkills,
      enabledToolIds: context.enabledToolIds,
      enqueuePart,
      providerConfig: context.providerConfig,
      streamFn: context.subagentStreamFn ?? streamAgentText,
      workspaceTools: context.workspaceTools,
    });
  }
  return aiTools;
}

async function buildLoopContext(prompt: string, context: WritingToolContext) {
  const system = buildSystemPrompt({
    defaultAgentMarkdown: context.defaultAgentMarkdown,
    enabledSkills: context.enabledSkills,
    enabledToolIds: context.enabledToolIds,
    mode: context.mode,
    modeContext: context.modeContext,
  });
  const currentUserContent = buildPromptContent(prompt, context);
  const messages = await buildLinearConversationMessages({
    entries: context.conversationEntries as never,
    history: context.conversationHistory,
    currentUserContent,
    summaryOptions: { summarizeHistory: buildHistorySummaryFn(context.providerConfig) },
  });

  logPromptDebug({
    label: context.debugLabel ?? "chat-turn",
    messages: messages.map((message) => ({
      content: normalizeDebugMessageContent(message.content),
      role: message.role,
    })),
    system,
  });
  return { messages, system };
}

export async function* runWritingPrompt({
  abortSignal,
  emit,
  prompt,
  takeFollowUpMessages,
  takeSteeringMessages,
  toolContext,
}: RunWritingPromptOptions): AsyncGenerator<AgentPart> {
  if (!hasProviderConfig(toolContext.providerConfig)) {
    yield { type: "text", text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。" };
    return;
  }

  const queue = createAsyncQueue<AgentPart>();
  const tools = buildTools(toolContext, abortSignal, (part) => queue.push(part));
  const loopContext = await buildLoopContext(prompt, toolContext);

  void (async () => {
    try {
      throwIfAborted(abortSignal);
      for await (const part of agentLoop(
        { ...loopContext, tools: Object.keys(tools).length > 0 ? tools : undefined },
        {
          abortSignal,
          emit,
          onUsage: toolContext.onUsage,
          providerConfig: toolContext.providerConfig,
          streamFn: toolContext.streamFn ?? streamAgentText,
          takeFollowUpMessages,
          takeSteeringMessages,
        },
      )) {
        throwIfAborted(abortSignal);
        queue.push(part);
      }
      queue.close();
    } catch (error) {
      queue.close(error);
    }
  })();

  for await (const part of queue.stream()) yield part;
}
