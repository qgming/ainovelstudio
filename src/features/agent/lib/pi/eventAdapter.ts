import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createToolResultPart } from "../domain/toolParts";
import type { AgentSessionEvent } from "../session/events";
import type { AgentPart, AgentUsage, AskToolAnswer, AskUserRequest } from "../types";
import { assistantMessageToAgentUsage, mapStopReasonToFinishReason, sumUsage } from "./usage";

// ask_user 工具通过 tool_execution_* 事件携带的 details 结构。
// askUserTool.ts 的 execute 返回 AgentToolResult.details 即此形态；
// 起始事件的 args 来自 LLM 原始入参（缺 customOptionId / selectionMode 默认值），故二者均设为可选。
export type AskUserToolDetails = Omit<AskUserRequest, "customOptionId" | "selectionMode"> & {
  customOptionId?: string;
  selectionMode?: AskUserRequest["selectionMode"];
  status: "awaiting_user" | "completed" | "failed";
  answer?: AskToolAnswer;
  errorMessage?: string;
};

// 适配产物：要 yield 的 AgentPart 序列 + 要 emit 的自研会话事件序列。
export type AdaptResult = {
  parts: AgentPart[];
  events: AgentSessionEvent[];
};

const EMPTY: AdaptResult = { parts: [], events: [] };

function stringifyInput(input: unknown) {
  try {
    return JSON.stringify(input) ?? "";
  } catch {
    return "";
  }
}

function isAskUserDetails(value: unknown): value is AskUserToolDetails {
  // selectionMode 是 schema 可选项（默认 single），不能作为识别条件，否则 LLM 省略它时会退化成普通 tool-call 卡片。
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    "options" in value
  );
}

// ask_user 自定义选项的保留 id（与 resourceToolset 的 ASK_CUSTOM_OPTION_ID 一致）。
// tool_execution_start.args 来自 LLM 原始入参，尚未经 normalizeAskRequest 补 customOptionId，这里兜底。
const ASK_CUSTOM_OPTION_ID = "__custom__";

// 把 ask_user 工具的 details 构造成 ask-user AgentPart。
function buildAskPartFromDetails(
  details: AskUserToolDetails,
  toolCallId: string,
): Extract<AgentPart, { type: "ask-user" }> {
  return {
    type: "ask-user",
    toolName: "ask_user",
    toolCallId,
    status: details.status,
    title: details.title,
    description: details.description,
    // selectionMode 可能缺省（LLM 未传），按 schema 默认补 single。
    selectionMode: details.selectionMode ?? "single",
    options: details.options,
    customOptionId: details.customOptionId ?? ASK_CUSTOM_OPTION_ID,
    customPlaceholder: details.customPlaceholder,
    minSelections: details.minSelections,
    maxSelections: details.maxSelections,
    confirmLabel: details.confirmLabel,
    answer: details.answer,
    errorMessage: details.errorMessage,
  };
}

/**
 * 把 pi 的 AgentEvent 适配成应用的 AgentPart 流 + 自研 AgentSessionEvent。
 *
 * 这是 pi 引擎与应用 UI 契约（AgentPart）之间的唯一桥接点。它有状态：
 * - 跟踪当前 turn 的 assistant 消息 id（自研事件需要 messageId）；
 * - 记住 ask_user 工具的请求详情，便于在工具结束时合成 completed ask-user part；
 * - 在 turn_end 取 message.usage 上报一次 usage（去重，message_end 不再报）。
 */
export class AgentEventAdapter {
  private currentMessageId = "";
  private turnIndex = 0;
  // 当前 turn 的 id：turn_start 生成并存下，turn_end 复用，保证同一 turn 的两端 id 一致
  //（旧实现两端各调一次 Date.now() 生成，时间戳不同导致 id 不匹配）。
  private currentTurnId = "";
  // 跨 turn 累计的用量：一条 assistant 消息可能跨多个 turn，turn_end 上报累计值而非单 turn 值。
  private accumulatedUsage: AgentUsage | null = null;
  // 缓存进行中的 ask_user 请求详情（toolCallId → details）：
  // 工具中止/抛错时 pi 返回的 error result 不含 ask 详情，需用缓存合成 failed 卡片，否则卡片永久停在 awaiting。
  private readonly askRequests = new Map<string, AskUserToolDetails>();

  constructor(
    private readonly options: {
      modelId: string;
      sessionId?: string;
      // ask_user 工具名，用于把工具事件分流成 ask-user part。
      askToolName?: string;
    },
  ) {}

  private get askToolName() {
    return this.options.askToolName ?? "ask_user";
  }

  adapt(event: AgentEvent): AdaptResult {
    switch (event.type) {
      case "agent_start":
        return { parts: [], events: [{ type: "agent_start", sessionId: this.options.sessionId }] };

      case "agent_end":
        return { parts: [], events: [{ type: "agent_end", sessionId: this.options.sessionId }] };

      case "turn_start": {
        this.turnIndex += 1;
        // id 改用 pi 的 uuidv7（同毫秒单调不碰撞），替代旧的 Date.now()-turnIndex，
        // 避免续轮/连续 run 在同一毫秒生成相同 assistant 消息 id 触发主键冲突。
        // 仍在 turn_start 生成一次并存下，turn_end 复用，保证同一 turn 两端 id 一致。
        this.currentTurnId = uuidv7();
        this.currentMessageId = `assistant-${this.currentTurnId}`;
        return {
          parts: [],
          events: [{ type: "turn_start", prompt: "", turnId: this.currentTurnId }],
        };
      }

      case "message_start":
        // pi 的 message_start 也覆盖 toolResult（工具结果消息）/ user（续轮注入）消息，
        // 它们的 role 不是 assistant。只有 assistant 的 message_start 才代表"助手轮开始"，
        // 应透出给 UI 层；其余直接吞掉——否则下游会把工具结果消息误判为新的助手轮
        //（曾导致每次工具调用都拆出第二条助手气泡 + 主键冲突）。
        if (event.message.role !== "assistant") {
          return EMPTY;
        }
        return {
          parts: [],
          events: [
            {
              type: "message_start",
              message: {
                id: this.currentMessageId,
                role: "assistant",
                author: "主代理",
                parts: [],
              },
            },
          ],
        };

      case "message_update":
        return this.adaptMessageUpdate(event.assistantMessageEvent);

      case "message_end":
        // 同 message_start：非 assistant 的 message_end（toolResult / user）不透出。
        if (event.message.role !== "assistant") {
          return EMPTY;
        }
        return {
          parts: [],
          events: [
            {
              type: "message_end",
              message: {
                id: this.currentMessageId,
                role: "assistant",
                author: "主代理",
                parts: [],
              },
            },
          ],
        };

      case "turn_end": {
        // pi 的 turn_end.message 类型是 AgentMessage（联合），需窄化到 assistant 才有 usage/stopReason。
        const message = event.message;
        if (message.role !== "assistant") {
          return EMPTY;
        }
        const assistantMessage = message as AssistantMessage;
        const finishReason = mapStopReasonToFinishReason(assistantMessage.stopReason);
        // 累计本条消息跨多个 turn 的用量，turn_end 上报累计值（下游 buildUsagePatch 整体替换 meta.usage）。
        this.accumulatedUsage = sumUsage(
          this.accumulatedUsage,
          assistantMessageToAgentUsage(assistantMessage, this.options.modelId),
        );
        // provider 失败时 pi 不抛异常，而是把失败放进 stopReason='error'/'aborted' + errorMessage；
        // 带出 errorMessage 供 runner 透出错误（否则 turn 会静默结束）。
        const errorMessage =
          assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted"
            ? assistantMessage.errorMessage
            : undefined;
        return {
          parts: [],
          events: [
            { type: "turn_end", finishReason, turnId: this.currentTurnId, usage: this.accumulatedUsage, errorMessage },
          ],
        };
      }

      case "tool_execution_start":
        return this.adaptToolStart(event.toolCallId, event.toolName, event.args);

      case "tool_execution_update":
        return this.adaptToolUpdate(event.toolCallId, event.toolName, event.partialResult);

      case "tool_execution_end":
        return this.adaptToolEnd(event.toolCallId, event.toolName, event.result, event.isError);

      default:
        return EMPTY;
    }
  }

  // 二级 switch：pi 把流式增量包在 message_update.assistantMessageEvent 里。
  private adaptMessageUpdate(inner: AssistantMessageEvent): AdaptResult {
    switch (inner.type) {
      case "text_delta": {
        const part: AgentPart = { type: "text-delta", delta: inner.delta, messageId: this.currentMessageId };
        return {
          parts: [part],
          events: [{ type: "message_update", messageId: this.currentMessageId, part }],
        };
      }
      case "thinking_delta": {
        const part: AgentPart = { type: "reasoning", summary: "", detail: inner.delta, messageId: this.currentMessageId };
        return {
          parts: [part],
          events: [{ type: "message_update", messageId: this.currentMessageId, part }],
        };
      }
      // 其余边界/工具调用增量事件：UI 由 mergePart 累积，不需要单独的 part。
      default:
        return EMPTY;
    }
  }

  private adaptToolStart(toolCallId: string, toolName: string, args: unknown): AdaptResult {
    // ask_user：起始即呈现"等待用户回答"卡片。
    if (toolName === this.askToolName && isAskUserDetails(args)) {
      const details: AskUserToolDetails = { ...args, status: "awaiting_user" };
      // 缓存请求详情，供工具中止/抛错时合成 failed 卡片。
      this.askRequests.set(toolCallId, details);
      const part = { ...buildAskPartFromDetails(details, toolCallId), messageId: this.currentMessageId };
      return {
        parts: [part],
        events: [
          { type: "message_update", messageId: this.currentMessageId, part },
          { type: "tool_execution_start", toolCallId, toolName },
        ],
      };
    }

    const part: AgentPart = {
      type: "tool-call",
      toolCallId,
      toolName,
      status: "running",
      inputSummary: stringifyInput(args),
      messageId: this.currentMessageId,
    };
    return {
      parts: [part],
      events: [
        { type: "message_update", messageId: this.currentMessageId, part },
        { type: "tool_execution_start", toolCallId, toolName },
      ],
    };
  }

  private adaptToolUpdate(toolCallId: string, toolName: string, partialResult: unknown): AdaptResult {
    // 仅 ask_user 的中间态有意义（仍是 awaiting_user）。
    const details = extractAskDetails(partialResult);
    if (toolName === this.askToolName && details) {
      // 刷新缓存，保证 failed 兜底用的是最新请求详情。
      this.askRequests.set(toolCallId, details);
      const part = { ...buildAskPartFromDetails(details, toolCallId), messageId: this.currentMessageId };
      return {
        parts: [part],
        events: [{ type: "tool_execution_update", part, toolCallId, toolName }],
      };
    }
    return EMPTY;
  }

  private adaptToolEnd(toolCallId: string, toolName: string, result: unknown, isError: boolean): AdaptResult {
    // ask_user：结束时合成 completed/failed 的 ask-user part。
    const details = extractAskDetails(result);
    if (toolName === this.askToolName && details) {
      this.askRequests.delete(toolCallId);
      const part = { ...buildAskPartFromDetails(details, toolCallId), messageId: this.currentMessageId };
      return {
        parts: [part],
        events: [{ type: "tool_execution_end", part, toolCallId, toolName }],
      };
    }

    // ask_user 中止/抛错时 pi 返回的 error result 不含 ask 详情，用缓存的请求合成 failed 卡片，
    // 否则卡片会永久停在 awaiting_user。
    const cachedAsk = this.askRequests.get(toolCallId);
    if (toolName === this.askToolName && isError && cachedAsk) {
      this.askRequests.delete(toolCallId);
      // 错误说明在 content 文本里（details 此时多为空对象），故直接取 content。
      const failedText = extractToolContentText(result).trim();
      const part = {
        ...buildAskPartFromDetails(
          {
            ...cachedAsk,
            status: "failed",
            errorMessage: failedText || "提问未完成。",
          },
          toolCallId,
        ),
        messageId: this.currentMessageId,
      };
      return {
        parts: [part],
        events: [{ type: "tool_execution_end", part, toolCallId, toolName }],
      };
    }
    this.askRequests.delete(toolCallId);

    const part: AgentPart = {
      ...createToolResultPart({
        output: extractToolOutput(result),
        status: isError ? "failed" : "completed",
        toolCallId,
        toolName,
      }),
      messageId: this.currentMessageId,
    };
    return {
      parts: [part],
      events: [{ type: "tool_execution_end", part, toolCallId, toolName }],
    };
  }
}

// pi AgentToolResult 的 details 字段里若是 ask_user 形态则取出。
function extractAskDetails(value: unknown): AskUserToolDetails | null {
  if (value && typeof value === "object" && "details" in value) {
    const details = (value as { details?: unknown }).details;
    if (isAskUserDetails(details)) return details;
  }
  if (isAskUserDetails(value)) return value;
  return null;
}

// 从 pi AgentToolResult.content 拼接文本块（工具的可读输出/错误说明）。
function extractToolContentText(result: unknown): string {
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .map((block) =>
          block && typeof block === "object" && "type" in block && (block as { type?: unknown }).type === "text"
            ? (block as { text?: string }).text ?? ""
            : "",
        )
        .join("");
    }
  }
  return "";
}

// 从 pi AgentToolResult 提取用于 tool-result 摘要的 output。
// 优先用 details（结构化），否则回退到 content 文本。
function extractToolOutput(result: unknown): unknown {
  if (result && typeof result === "object") {
    if ("details" in result && (result as { details?: unknown }).details !== undefined) {
      return (result as { details?: unknown }).details;
    }
    const text = extractToolContentText(result);
    if (text || (result as { content?: unknown }).content !== undefined) {
      return text;
    }
  }
  return result;
}
