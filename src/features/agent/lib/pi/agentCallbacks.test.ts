import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { buildAgentCallbacks } from "./agentCallbacks";

function assistantMessage(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "openai-completions",
    provider: "p",
    model: "m",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: Date.now(),
  };
}

describe("agentCallbacks", () => {
  it("shouldStopAfterTurn: book 模式达到步数上限后停止", () => {
    const cb = buildAgentCallbacks({ mode: "book" });
    // 模拟 999 轮：未到 1000 不停
    for (let i = 0; i < 999; i += 1) cb.prepareNextTurn({ message: assistantMessage("x") as never });
    expect(cb.shouldStopAfterTurn()).toBe(false);
    cb.prepareNextTurn({ message: assistantMessage("x") as never }); // 第 1000 轮
    expect(cb.shouldStopAfterTurn()).toBe(true);
  });

  it("shouldStopAfterTurn: autopilot 模式永不停止", () => {
    const cb = buildAgentCallbacks({ mode: "autopilot" });
    for (let i = 0; i < 5000; i += 1) cb.prepareNextTurn({ message: assistantMessage("x") as never });
    expect(cb.shouldStopAfterTurn()).toBe(false);
  });

  it("getSteeringMessages: 把队列文本转成 user 消息", async () => {
    const queue = ["插话1", "插话2"];
    const cb = buildAgentCallbacks({
      mode: "book",
      takeSteeringMessages: () => queue.splice(0, queue.length),
    });
    const messages = await cb.getSteeringMessages();
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "插话1" }),
      expect.objectContaining({ role: "user", content: "插话2" }),
    ]);
  });

  it("getFollowUpMessages: 无 repair 配置时直接吐真实 followUp", async () => {
    const queue = ["后续任务"];
    const cb = buildAgentCallbacks({
      mode: "book",
      takeFollowUpMessages: () => queue.splice(0, queue.length),
    });
    cb.prepareNextTurn({ message: assistantMessage("普通回复") as never });
    const messages = await cb.getFollowUpMessages();
    expect(messages).toEqual([expect.objectContaining({ role: "user", content: "后续任务" })]);
  });

  it("getFollowUpMessages: 写入任务但未调用写入工具时注入 repair（仅一次）", async () => {
    const cb = buildAgentCallbacks({
      mode: "book",
      writeProtocolRepair: { enabledToolIds: ["workspace_write"], userPrompt: "帮我写第001章正文" },
    });
    // 上一轮以普通文本结束、没有写入工具调用 → 应触发 repair
    cb.prepareNextTurn({ message: assistantMessage("现在开始写第001章") as never });
    const first = await cb.getFollowUpMessages();
    expect(first).toHaveLength(1);
    expect((first[0] as { content: string }).content).toContain("协议修复");

    // 第二次不再重复触发 repair（repairCount > 0），且无真实 followUp → 返回空
    cb.prepareNextTurn({ message: assistantMessage("还是普通文本") as never });
    const second = await cb.getFollowUpMessages();
    expect(second).toEqual([]);
  });

  it("getFollowUpMessages: 已调用写入工具时不触发 repair", async () => {
    const cb = buildAgentCallbacks({
      mode: "book",
      writeProtocolRepair: { enabledToolIds: ["workspace_write"], userPrompt: "帮我写第001章正文" },
    });
    const message: AssistantMessage = {
      ...assistantMessage("", "toolUse"),
      content: [{ type: "toolCall", id: "c1", name: "workspace_write", arguments: {} }],
    };
    cb.prepareNextTurn({ message: message as never });
    const result = await cb.getFollowUpMessages();
    expect(result).toEqual([]);
  });
});
