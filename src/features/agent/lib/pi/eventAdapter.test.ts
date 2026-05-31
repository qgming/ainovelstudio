import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AgentEventAdapter, type AskUserToolDetails } from "./eventAdapter";
import type { AskUserRequest } from "../types";

function buildAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "ainovelstudio-provider",
    model: "gpt-4.1",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

const askRequest: AskUserRequest = {
  title: "选择风格",
  selectionMode: "single",
  options: [{ id: "a", label: "热血" }],
  customOptionId: "custom",
};

describe("AgentEventAdapter", () => {
  it("text_delta → text-delta part + message_update 事件", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const messageId = (
      adapter.adapt({ type: "message_start", message: buildAssistantMessage() } as AgentEvent)
        .events[0] as { message: { id: string } }
    ).message.id;

    const result = adapter.adapt({
      type: "message_update",
      message: buildAssistantMessage(),
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "你好", partial: buildAssistantMessage() },
    } as AgentEvent);

    expect(result.parts).toEqual([{ type: "text-delta", delta: "你好", messageId }]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: "message_update", part: { type: "text-delta", delta: "你好" } });
  });

  it("thinking_delta → reasoning part", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const result = adapter.adapt({
      type: "message_update",
      message: buildAssistantMessage(),
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "思考中", partial: buildAssistantMessage() },
    } as AgentEvent);

    expect(result.parts[0]).toMatchObject({ type: "reasoning", summary: "", detail: "思考中" });
  });

  it("文本边界事件（text_start/text_end）不产 part", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    const result = adapter.adapt({
      type: "message_update",
      message: buildAssistantMessage(),
      assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: buildAssistantMessage() },
    } as AgentEvent);
    expect(result.parts).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("普通工具 tool_execution_start → tool-call(running) part + tool_execution_start 事件", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    // 先走 turn_start，使 adapter 分配 currentMessageId，part 据此带 messageId 用于路由。
    const start = adapter.adapt({ type: "turn_start" } as AgentEvent);
    const messageId = (
      adapter.adapt({ type: "message_start", message: buildAssistantMessage() } as AgentEvent)
        .events[0] as { message: { id: string } }
    ).message.id;
    const result = adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "write",
      args: { path: "a.md" },
    } as AgentEvent);

    expect(result.parts).toEqual([
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "write",
        status: "running",
        inputSummary: JSON.stringify({ path: "a.md" }),
        messageId,
      },
    ]);
    // tool-call part 的 messageId 应与 message_start 的 assistant 消息 id 一致。
    expect(messageId).toBeTruthy();
    expect((start.events[0] as { turnId: string }).turnId).toBeTruthy();
    expect(result.events.map((e) => e.type)).toEqual(["message_update", "tool_execution_start"]);
  });

  it("普通工具 tool_execution_end → tool-result(completed) part 带所属 messageId", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const messageId = (
      adapter.adapt({ type: "message_start", message: buildAssistantMessage() } as AgentEvent)
        .events[0] as { message: { id: string } }
    ).message.id;
    const result = adapter.adapt({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "write",
      result: { content: [{ type: "text", text: "ok" }], details: { ok: true } },
      isError: false,
    } as AgentEvent);

    expect(result.parts[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "write",
      status: "completed",
      messageId,
    });
    expect(result.events[0]).toMatchObject({ type: "tool_execution_end", toolName: "write" });
  });

  it("工具失败 isError=true → tool-result(failed)", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    const result = adapter.adapt({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "write",
      result: { content: [{ type: "text", text: "boom" }], details: "boom" },
      isError: true,
    } as AgentEvent);
    expect(result.parts[0]).toMatchObject({ type: "tool-result", status: "failed" });
  });

  it("ask_user 起始 → ask-user(awaiting_user) part", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    const args: AskUserToolDetails = { ...askRequest, status: "awaiting_user" };
    const result = adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "call_ask",
      toolName: "ask_user",
      args,
    } as AgentEvent);

    expect(result.parts[0]).toMatchObject({
      type: "ask-user",
      toolName: "ask_user",
      toolCallId: "call_ask",
      status: "awaiting_user",
      title: "选择风格",
    });
  });

  it("ask_user 结束 → ask-user(completed) part 带 answer", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    const details: AskUserToolDetails = {
      ...askRequest,
      status: "completed",
      answer: {
        selectionMode: "single",
        values: [{ type: "option", id: "a", label: "热血", value: "热血" }],
        usedCustomInput: false,
      },
    };
    const result = adapter.adapt({
      type: "tool_execution_end",
      toolCallId: "call_ask",
      toolName: "ask_user",
      result: { content: [{ type: "text", text: "热血" }], details },
      isError: false,
    } as AgentEvent);

    expect(result.parts[0]).toMatchObject({
      type: "ask-user",
      status: "completed",
      answer: { values: [{ label: "热血" }] },
    });
  });

  it("turn_end → 取 message.usage 产 turn_end 事件（finishReason 映射）", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const result = adapter.adapt({
      type: "turn_end",
      message: buildAssistantMessage({ stopReason: "toolUse" }),
      toolResults: [],
    } as AgentEvent);

    expect(result.parts).toEqual([]);
    expect(result.events[0]).toMatchObject({
      type: "turn_end",
      finishReason: "tool-calls",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("多轮 turn_end → usage 累计（非仅末轮）", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const first = adapter.adapt({
      type: "turn_end",
      message: buildAssistantMessage({ stopReason: "toolUse" }),
      toolResults: [],
    } as AgentEvent);
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const second = adapter.adapt({
      type: "turn_end",
      message: buildAssistantMessage({ stopReason: "stop" }),
      toolResults: [],
    } as AgentEvent);

    // 第一轮 10/5，第二轮再 10/5，累计应为 20/10、totalTokens 30。
    expect(first.events[0]).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    expect(second.events[0]).toMatchObject({
      type: "turn_end",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
  });

  it("turn_start 与 turn_end 的 turnId 一致（同一 turn 复用）", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    const start = adapter.adapt({ type: "turn_start" } as AgentEvent);
    const end = adapter.adapt({
      type: "turn_end",
      message: buildAssistantMessage(),
      toolResults: [],
    } as AgentEvent);
    const startTurnId = (start.events[0] as { turnId: string }).turnId;
    const endTurnId = (end.events[0] as { turnId: string }).turnId;
    expect(startTurnId).toBeTruthy();
    expect(endTurnId).toBe(startTurnId);
  });

  it("turn_end 失败（stopReason=error）→ 事件携带 errorMessage", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const result = adapter.adapt({
      type: "turn_end",
      message: buildAssistantMessage({ stopReason: "error", errorMessage: "上游 500" }),
      toolResults: [],
    } as AgentEvent);
    expect(result.events[0]).toMatchObject({ type: "turn_end", finishReason: "error", errorMessage: "上游 500" });
  });

  it("ask_user 起始缺 selectionMode 仍出 awaiting 卡片并兜底 single", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    // 模拟 LLM 原始入参省略 selectionMode（schema 可选，默认 single）。
    const args = { title: "选择风格", options: [{ id: "a", label: "热血" }], status: "awaiting_user" };
    const result = adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "call_ask",
      toolName: "ask_user",
      args,
    } as AgentEvent);
    expect(result.parts[0]).toMatchObject({
      type: "ask-user",
      status: "awaiting_user",
      selectionMode: "single",
      title: "选择风格",
    });
  });

  it("ask_user 中止/抛错 → 用缓存合成 failed 卡片（不退化成 tool-result）", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    const args: AskUserToolDetails = { ...askRequest, status: "awaiting_user" };
    adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "call_ask",
      toolName: "ask_user",
      args,
    } as AgentEvent);
    // pi 在工具抛错时返回不含 ask 详情的 error result。
    const result = adapter.adapt({
      type: "tool_execution_end",
      toolCallId: "call_ask",
      toolName: "ask_user",
      result: { content: [{ type: "text", text: "已取消" }], details: {} },
      isError: true,
    } as AgentEvent);

    expect(result.parts[0]).toMatchObject({
      type: "ask-user",
      toolCallId: "call_ask",
      status: "failed",
      title: "选择风格",
      errorMessage: "已取消",
    });
  });

  it("agent_start / agent_end 产生对应会话事件", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1", sessionId: "s1" });
    expect(adapter.adapt({ type: "agent_start" } as AgentEvent).events[0]).toMatchObject({
      type: "agent_start",
      sessionId: "s1",
    });
    expect(adapter.adapt({ type: "agent_end", messages: [] } as AgentEvent).events[0]).toMatchObject({
      type: "agent_end",
      sessionId: "s1",
    });
  });

  it("非 assistant 的 message_start/message_end（toolResult / user）不透出事件", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    adapter.adapt({ type: "turn_start" } as AgentEvent);

    // pi 在工具执行后会为工具结果消息（role=toolResult）发 message_start/message_end，
    // 续轮注入的 user 消息也会发 message_start/message_end。它们都不是"助手轮开始"，
    // adapter 必须吞掉，否则下游会把工具结果误判为新助手轮（曾导致拆两条气泡 + 主键冲突）。
    const toolResultStart = adapter.adapt({
      type: "message_start",
      message: { role: "toolResult", toolCallId: "call_1", toolName: "write", content: [], isError: false, timestamp: Date.now() },
    } as unknown as AgentEvent);
    const toolResultEnd = adapter.adapt({
      type: "message_end",
      message: { role: "toolResult", toolCallId: "call_1", toolName: "write", content: [], isError: false, timestamp: Date.now() },
    } as unknown as AgentEvent);
    const userStart = adapter.adapt({
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "继续" }], timestamp: Date.now() },
    } as unknown as AgentEvent);

    expect(toolResultStart).toEqual({ parts: [], events: [] });
    expect(toolResultEnd).toEqual({ parts: [], events: [] });
    expect(userStart).toEqual({ parts: [], events: [] });
  });

  it("续轮：每轮 part 带各自轮次的 messageId（runner 已统一 fallback 到单条 seed 消息，此处仅验 adapter 输出）", () => {
    const adapter = new AgentEventAdapter({ modelId: "gpt-4.1" });
    // 第 1 轮：turn_start → tool-call + tool-result。
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const m1 = (
      adapter.adapt({ type: "message_start", message: buildAssistantMessage() } as AgentEvent)
        .events[0] as { message: { id: string } }
    ).message.id;
    const call1 = adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "workspace_read",
      args: { path: "a.md" },
    } as AgentEvent).parts[0];
    const result1 = adapter.adapt({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "workspace_read",
      result: { content: [{ type: "text", text: "ok" }], details: { ok: true } },
      isError: false,
    } as AgentEvent).parts[0];

    // 第 2 轮：新的 turn_start → 新 messageId。
    adapter.adapt({ type: "turn_start" } as AgentEvent);
    const m2 = (
      adapter.adapt({ type: "message_start", message: buildAssistantMessage() } as AgentEvent)
        .events[0] as { message: { id: string } }
    ).message.id;
    const call2 = adapter.adapt({
      type: "tool_execution_start",
      toolCallId: "call_2",
      toolName: "workspace_read",
      args: { path: "b.md" },
    } as AgentEvent).parts[0];

    expect(m1).not.toBe(m2);
    expect((call1 as { messageId?: string }).messageId).toBe(m1);
    expect((result1 as { messageId?: string }).messageId).toBe(m1);
    expect((call2 as { messageId?: string }).messageId).toBe(m2);
  });
});
