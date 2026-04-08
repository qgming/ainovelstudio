import { describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./session";
import type { AgentPart } from "./types";

describe("agent session (streaming)", () => {
  it("未配置 provider 时 yield 提示文本", async () => {
    const parts: AgentPart[] = [];

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "你好",
      providerConfig: {
        apiKey: "",
        baseURL: "",
        maxOutputTokens: 4096,
        model: "",
        temperature: 0.7,
      },
      workspaceTools: {},
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("设置"),
    });
  });

  it("使用注入的 _streamFn 进行流式输出", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "你好" };
      yield { type: "text-delta" as const, text: "世界" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "chapter-1.md",
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "续写",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(parts).toEqual([
      { type: "text-delta", delta: "你好" },
      { type: "text-delta", delta: "世界" },
    ]);
  });

  it("传入 abortSignal 给流式调用", async () => {
    const abortSignal = new AbortController().signal;
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        return;
      })(),
    });

    const stream = runAgentTurn({
      abortSignal,
      activeFilePath: null,
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "停止测试",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // no-op
    }

    expect(mockStreamFn.mock.calls[0][0].abortSignal).toBe(abortSignal);
  });

  it("目录树工具把真实目录树返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "tool-call" as const, toolName: "read_workspace_tree", input: {} };
      yield {
        type: "tool-result" as const,
        toolName: "read_workspace_tree",
        output: {
          kind: "directory",
          name: "北境余烬",
          path: "C:/books/北境余烬",
          children: [{ kind: "directory", name: "章节", path: "C:/books/北境余烬/章节" }],
        },
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledSkills: [],
      enabledToolIds: ["read_workspace_tree"],
      prompt: "读取目录树",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
      },
      workspaceTools: {
        read_workspace_tree: {
          description: "读取当前工作区目录树",
          execute: async () => ({
            ok: true,
            summary: "已读取工作区 北境余烬",
            data: {
              kind: "directory",
              name: "北境余烬",
              path: "C:/books/北境余烬",
              children: [{ kind: "directory", name: "章节", path: "C:/books/北境余烬/章节" }],
            },
          }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].tools?.read_workspace_tree).toBeDefined();
    expect(parts).toEqual([
      { type: "tool-call", toolName: "read_workspace_tree", status: "running", inputSummary: "{}" },
      {
        type: "tool-result",
        toolName: "read_workspace_tree",
        status: "completed",
        outputSummary:
          '{"kind":"directory","name":"北境余烬","path":"C:/books/北境余烬","children":[{"kind":"directory","name":"章节","path":"C:/books/北境余烬/章节"}]}',
      },
    ]);
  });
});
