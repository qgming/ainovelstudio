import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { runWritingAgentPi } from "./writingSessionRunner";
import type { WritingRuntimeContext } from "../writingRuntimeContext";
import type { AgentPart } from "../types";
import type { ToolResult, AgentTool as WorkspaceTool } from "../runtime";

function buildAssistant(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "ainovelstudio-provider",
    model: "test-model",
    usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1,
    ...overrides,
  };
}

// 构造一个 pi streamFn：先吐一段文本增量，再以指定 final message 收尾。
// 若 finalsByCall 提供多个，则按 turn 依次返回（用于工具循环：第一轮 toolUse，第二轮 stop）。
function makeStreamFn(finals: AssistantMessage[]): StreamFn {
  let call = 0;
  return ((_model: Model<"openai-completions">, _context: Context, _options?: SimpleStreamOptions) => {
    const final = finals[Math.min(call, finals.length - 1)];
    call += 1;
    const stream = createAssistantMessageEventStream();
    const partial = buildAssistant({ content: [] });
    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      // 文本增量（若 final 含文本）
      const textBlock = final.content.find((c) => c.type === "text");
      if (textBlock && textBlock.type === "text") {
        stream.push({ type: "text_delta", contentIndex: 0, delta: textBlock.text, partial });
      }
      if (final.stopReason === "error" || final.stopReason === "aborted") {
        stream.push({ type: "error", reason: final.stopReason, error: final });
      } else {
        stream.push({ type: "done", reason: final.stopReason as "stop" | "length" | "toolUse", message: final });
      }
      stream.end(final);
    });
    return stream;
  }) as StreamFn;
}

function makeWorkspaceTool(impl: () => ToolResult): WorkspaceTool {
  return { description: "t", execute: async () => impl() };
}

function baseContext(overrides: Partial<WritingRuntimeContext> = {}): WritingRuntimeContext {
  return {
    activeFilePath: null,
    enabledSkills: [],
    enabledToolIds: [],
    mode: "book",
    providerConfig: { apiKey: "sk-test", baseURL: "https://example.com/v1", model: "test-model" },
    workspaceTools: {},
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<AgentPart>): Promise<AgentPart[]> {
  const parts: AgentPart[] = [];
  for await (const part of gen) parts.push(part);
  return parts;
}

describe("runWritingAgentPi", () => {
  it("未配置 provider 时给出提示文本", async () => {
    const parts = await collect(
      runWritingAgentPi({
        abortSignal: new AbortController().signal,
        emit: () => {},
        prompt: "写第一章",
        takeFollowUpMessages: () => [],
        takeSteeringMessages: () => [],
        toolContext: baseContext({ providerConfig: { apiKey: "", baseURL: "", model: "" } }),
      }),
    );
    expect(parts).toEqual([{ type: "text", text: expect.stringContaining("请先前往设置页") }]);
  });

  it("纯文本回复：产出 text-delta part 并上报 usage", async () => {
    const onUsage = vi.fn();
    const parts = await collect(
      runWritingAgentPi({
        abortSignal: new AbortController().signal,
        emit: () => {},
        prompt: "写第一章",
        takeFollowUpMessages: () => [],
        takeSteeringMessages: () => [],
        toolContext: baseContext({
          onUsage,
          streamFn: makeStreamFn([buildAssistant({ content: [{ type: "text", text: "好的，开始" }], stopReason: "stop" })]),
        }),
      }),
    );
    expect(parts).toContainEqual({ type: "text-delta", delta: "好的，开始" });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 5, outputTokens: 3 }));
  });

  it("工具调用循环：第一轮 toolUse 调 write，第二轮 stop 收尾", async () => {
    const writeTool = makeWorkspaceTool(() => ({ ok: true, summary: "已写入 a.md" }));
    const emit = vi.fn();
    const parts = await collect(
      runWritingAgentPi({
        abortSignal: new AbortController().signal,
        emit,
        prompt: "写第一章",
        takeFollowUpMessages: () => [],
        takeSteeringMessages: () => [],
        toolContext: baseContext({
          enabledToolIds: ["workspace_write"],
          workspaceTools: { workspace_write: writeTool },
          streamFn: makeStreamFn([
            buildAssistant({
              content: [{ type: "toolCall", id: "c1", name: "workspace_write", arguments: { path: "a.md", content: "正文" } }],
              stopReason: "toolUse",
            }),
            buildAssistant({ content: [{ type: "text", text: "完成" }], stopReason: "stop" }),
          ]),
        }),
      }),
    );

    // 应出现 tool-call(running) 与 tool-result(completed)，以及最终文本。
    expect(parts.some((p) => p.type === "tool-call" && p.toolName === "workspace_write")).toBe(true);
    expect(parts.some((p) => p.type === "tool-result" && p.status === "completed")).toBe(true);
    expect(parts.some((p) => p.type === "text-delta" && p.delta === "完成")).toBe(true);
    // emit 应包含 tool_execution_start / tool_execution_end
    const emittedTypes = emit.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(emittedTypes).toContain("tool_execution_start");
    expect(emittedTypes).toContain("tool_execution_end");
  });

  it("流失败（stopReason=error）：生成器抛出 errorMessage（透出到终端层呈现）", async () => {
    const gen = runWritingAgentPi({
      abortSignal: new AbortController().signal,
      emit: () => {},
      prompt: "写第一章",
      takeFollowUpMessages: () => [],
      takeSteeringMessages: () => [],
      toolContext: baseContext({
        streamFn: makeStreamFn([buildAssistant({ stopReason: "error", errorMessage: "上游错误" })]),
      }),
    });
    // pi 在 error 时优雅收尾（emit error turn_end + agent_end，不 reject），runner 据此捕获并在收尾时抛出，
    // 经 drainPrompt 的 output.close(error) 透出到终端层 handleFailure 呈现错误消息（否则 turn 静默结束）。
    await expect(collect(gen)).rejects.toThrow("上游错误");
  });
});
