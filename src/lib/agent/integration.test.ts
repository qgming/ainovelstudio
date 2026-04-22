import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "./promptContext";
import { runAgentTurn } from "./session";
import type { AgentPart } from "./types";

describe("agent session (streaming)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("未配置 provider 时 yield 提示文本", async () => {
    const parts: AgentPart[] = [];

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "你好",
      providerConfig: {
        apiKey: "",
        baseURL: "",
        model: "",
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
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "续写",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
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

  it("会把项目默认上下文注入当前轮消息", async () => {
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        return;
      })(),
    });

    const stream = runAgentTurn({
      activeFilePath: "chapter-1.md",
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      projectContext: {
        source: "项目默认上下文",
        files: [
          {
            content: "# 项目规则\n\n先读取设定。",
            name: "AGENTS.md",
            path: ".project/AGENTS.md",
          },
          {
            content: '{"chapter": 12}',
            name: "latest-plot.json",
            path: ".project/status/latest-plot.json",
          },
        ],
      },
      prompt: "续写",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const call = mockStreamFn.mock.calls[0]?.[0];
    expect(call?.messages?.[0]?.content).toContain("## s14 项目默认上下文");
    expect(call?.messages?.[0]?.content).toContain(".project/AGENTS.md");
    expect(call?.messages?.[0]?.content).toContain(".project/status/latest-plot.json");
    expect(call?.messages?.[0]?.content).toContain("先读取设定");
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
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "停止测试",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // no-op
    }

    expect(mockStreamFn.mock.calls[0][0].abortSignal).toBe(abortSignal);
  });

  it("停止后会中断正在等待的工具执行", async () => {
    const abortController = new AbortController();
    let resolveTool:
      | ((value: { ok: true; summary: string }) => void)
      | undefined;
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        return;
      })(),
    });

    const stream = runAgentTurn({
      abortSignal: abortController.signal,
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read"],
      prompt: "读取文件",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read: {
          description: "读取文件",
          execute: async () =>
            new Promise((resolve) => {
              resolveTool = resolve;
            }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const tool = mockStreamFn.mock.calls[0][0].tools?.read as
      | {
          execute?: (
            input: { path: string },
            options: unknown,
          ) => Promise<unknown>;
        }
      | undefined;
    expect(tool).toBeDefined();

    const pending = tool?.execute?.({ path: "章节/第一章.md" }, {} as never);
    expect(pending).toBeDefined();
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    resolveTool?.({ ok: true, summary: "已读取当前章节" });
  });

  it("工具执行时会透传 requestId 并上报开始结束状态", async () => {
    const events: Array<{ requestId: string; status: "start" | "finish" }> = [];
    const executeMock = vi.fn().mockResolvedValue({
      ok: true,
      summary: "已读取当前章节",
    });
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        return;
      })(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read"],
      prompt: "读取文件",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read: {
          description: "读取文件",
          execute: executeMock,
        },
      },
      onToolRequestStateChange: (event) => {
        events.push(event);
      },
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const tool = mockStreamFn.mock.calls[0][0].tools?.read as
      | {
          execute?: (
            input: { path: string },
            options: unknown,
          ) => Promise<unknown>;
        }
      | undefined;
    await tool?.execute?.({ path: "章节/第一章.md" }, {} as never);

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledWith(
      { path: "章节/第一章.md" },
      expect.objectContaining({
        abortSignal: undefined,
        requestId: expect.stringMatching(/^tool-read-/),
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ status: "start" });
    expect(events[1]).toMatchObject({ status: "finish" });
    expect(events[0]?.requestId).toBe(events[1]?.requestId);
  });

  it("停止后不会等待 usage 收尾", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    let releaseUsage: (() => void) | undefined;
    const usagePromise = new Promise<{
      recordedAt: string;
      provider: string;
      modelId: string;
      finishReason: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      noCacheTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      reasoningTokens: number;
    }>((resolve) => {
      releaseUsage = () =>
        resolve({
          recordedAt: "1",
          provider: "ainovelstudio-provider",
          modelId: "test-model",
          finishReason: "stop",
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          noCacheTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        });
    });
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta" as const, text: "第一段" };
      })(),
      usagePromise,
    });

    const stream = runAgentTurn({
      abortSignal: abortController.signal,
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "停止测试",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    const first = await stream.next();
    expect(first.value).toEqual({ type: "text-delta", delta: "第一段" });

    abortController.abort();
    const nextPromise = stream.next();
    const rejection = expect(nextPromise).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.runAllTimersAsync();
    await rejection;

    releaseUsage?.();
  });

  it("停止后不会继续 flush 子代理残留快照", async () => {
    const abortController = new AbortController();
    let released = false;
    const mockSubagentStreamFn = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { type: "reasoning-delta" as const, text: "正在分析。" };
        abortController.abort();
        released = true;
        yield { type: "text-delta" as const, text: "不应继续输出" };
      })(),
      usagePromise: Promise.resolve(null),
    });
    const mockStreamFn = vi
      .fn()
      .mockImplementation(
        (request: {
          tools?: Record<
            string,
            {
              execute?: (
                input: { prompt: string; agentId?: string },
                options: unknown,
              ) => Promise<unknown>;
            }
          >;
        }) => {
          const taskTool = request.tools?.task;
          return {
            fullStream: (async function* () {
              yield {
                type: "tool-call" as const,
                toolName: "task",
                toolCallId: "task-call-stop-1",
                input: { prompt: "帮我分析主角动机", agentId: "plot-agent" },
              };
              await taskTool?.execute?.(
                { prompt: "帮我分析主角动机", agentId: "plot-agent" },
                {} as never,
              );
            })(),
            usagePromise: Promise.resolve(null),
          };
        },
      );
    const enabledAgent: ResolvedAgent = {
      id: "plot-agent",
      name: "剧情代理",
      description: "负责剧情推进",
      role: "剧情",
      tags: ["剧情", "动机"],
      sourceLabel: "内置",
      body: "专注处理剧情与人物动机。",
      suggestedTools: ["read"],
      enabled: true,
      files: ["manifest.json", "AGENTS.md"],
      sourceKind: "builtin-package",
      dispatchHint: "当用户询问剧情推进时",
      validation: { errors: [], isValid: true, warnings: [] },
      discoveredAt: 1,
      isBuiltin: true,
      manifestFilePath: "agents/plot-agent/manifest.json",
    };

    const stream = runAgentTurn({
      abortSignal: abortController.signal,
      activeFilePath: "章节/第一章.md",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["task"],
      prompt: "帮我分析主角动机",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
      _subagentStreamFn: mockSubagentStreamFn,
    });

    const parts: AgentPart[] = [];
    await expect(
      (async () => {
        for await (const part of stream) {
          parts.push(part);
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(released).toBe(true);
    expect(
      parts.some(
        (part) => part.type === "subagent" && part.status === "completed",
      ),
    ).toBe(false);
    expect(
      parts.some(
        (part) =>
          part.type === "subagent" &&
          part.parts.some(
            (inner) =>
              inner.type === "text" && inner.text.includes("不应继续输出"),
          ),
      ),
    ).toBe(false);
  });

  it("后续轮次会把上一轮的用户与 AI 回复一起发送给模型", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第二章.md",
      workspaceRootPath: "C:/books/北境余烬",
      conversationHistory: [
        {
          id: "user-1",
          role: "user",
          author: "你",
          parts: [{ type: "text", text: "先总结上一章" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          author: "主代理",
          parts: [{ type: "text", text: "上一章的核心冲突是主角是否进城。" }],
        },
      ],
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "继续分析第二章",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const request = mockStreamFn.mock.calls[0][0];
    expect(request.messages).toHaveLength(3);
    expect(request.messages[0]).toEqual({
      role: "user",
      content: "先总结上一章",
    });
    expect(request.messages[1]).toEqual({
      role: "assistant",
      content: "上一章的核心冲突是主角是否进城。",
    });
    expect(request.messages[2].role).toBe("user");
    expect(request.messages[2].content).toContain("继续分析第二章");
    expect(request.messages[2].content).toContain(
      "- 当前工作区：C:/books/北境余烬",
    );
  });

  it("连续对话时会把上一轮工具结果带入下一轮输入", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第三章.md",
      workspaceRootPath: "C:/books/北境余烬",
      conversationHistory: [
        {
          id: "user-1",
          role: "user",
          author: "你",
          parts: [{ type: "text", text: "先读取第一章设定" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          author: "主代理",
          parts: [
            {
              type: "tool-call",
              toolName: "read",
              toolCallId: "call-history-1",
              status: "completed",
              inputSummary: '{"path":"设定/人物.md"}',
            },
            {
              type: "tool-result",
              toolName: "read",
              toolCallId: "call-history-1",
              status: "completed",
              outputSummary: "主角：林燃；目标：逃离北城",
            },
            { type: "text", text: "我已经提炼出主角目标。" },
          ],
        },
      ],
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "继续分析第三章承接是否自然",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const request = mockStreamFn.mock.calls[0][0];
    expect(request.messages[1]).toEqual({
      role: "assistant",
      content: [
        "工具调用 [call-history-1] read",
        '输入摘要：{"path":"设定/人物.md"}',
        "",
        "工具结果 [call-history-1] read",
        "输出摘要：主角：林燃；目标：逃离北城",
        "",
        "我已经提炼出主角目标。",
      ].join("\n"),
    });
  });

  it("把默认 AGENTS 和结构化用户上下文传给模型", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      defaultAgentMarkdown: "# 自定义主代理\n\n- 优先吸收上下文后回答。",
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      prompt: "帮我整理这一章的冲突节奏",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const request = mockStreamFn.mock.calls[0][0];
    expect(request.system).toContain("## s02 已启用工具");
    expect(request.system).toContain("## s04 主代理人设");
    expect(request.system).toContain("# 自定义主代理");
    expect(request.system).not.toContain(DEFAULT_MAIN_AGENT_MARKDOWN);
    expect(request.messages[0].content).toContain("# 当前轮上下文");
    expect(request.messages[0].content).toContain("## s10 当前轮动态上下文");
    expect(request.messages[0].content).toContain(
      "- 当前工作区：C:/books/北境余烬",
    );
    expect(request.messages[0].content).toContain(
      "- 当前激活文件：章节/第一章.md",
    );
    expect(request.messages[0].content).toContain(
      "- 当前文件类型：章节/正文稿件",
    );
    expect(request.messages[0].content).toContain("- 本轮任务类型：分析/诊断");
    expect(request.messages[0].content).toContain("## s15 用户请求");
    expect(request.messages[0].content).toContain("帮我整理这一章的冲突节奏");
  });

  it("把手动选择的技能、子代理和文件内容注入当前轮上下文", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      manualContext: {
        skills: [
          {
            id: "plot-skill",
            name: "剧情规划",
            description: "拆解冲突和节奏。",
          },
        ],
        agents: [
          {
            id: "writer-agent",
            name: "续写代理",
            description: "负责续写章节。",
            role: "续写与润色",
          },
        ],
        files: [
          {
            path: "设定/人物.md",
            name: "人物.md",
            content: "主角：林燃\n目标：逃离北城",
          },
        ],
      },
      prompt: "继续写这一章",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const request = mockStreamFn.mock.calls[0][0];
    expect(request.messages[0].content).toContain("## s15 手动指定上下文");
    expect(request.messages[0].content).toContain("### 手动指定技能");
    expect(request.messages[0].content).toContain("剧情规划：拆解冲突和节奏。");
    expect(request.messages[0].content).toContain("### 手动指定子代理");
    expect(request.messages[0].content).toContain(
      "续写代理（续写与润色）：负责续写章节。",
    );
    expect(request.messages[0].content).toContain("### 手动指定文件");
    expect(request.messages[0].content).toContain("#### 人物.md");
    expect(request.messages[0].content).toContain("主角：林燃");
    expect(request.messages[0].content).toContain("## s15 用户请求");
  });

  it("多步任务但没有计划时，会在当前轮上下文里注入先规划提醒", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      planningState: { items: [], roundsSinceUpdate: 0 },
      prompt: "先定位问题，再修复并跑测试",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const content =
      mockStreamFn.mock.calls[0][0].messages[
        mockStreamFn.mock.calls[0][0].messages.length - 1
      ]?.content;
    expect(content).toContain("## s12 计划执行提醒");
    expect(content).toContain("请先用 todo 写出当前短计划");
    expect(content).not.toContain("## s13 当前计划状态");
  });

  it("计划连续多轮未更新时，会在当前轮上下文里注入刷新提醒", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      planningState: {
        items: [
          {
            content: "修复问题",
            status: "in_progress",
            activeForm: "正在修复问题",
          },
        ],
        roundsSinceUpdate: 3,
      },
      prompt: "继续分析这个问题",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const content =
      mockStreamFn.mock.calls[0][0].messages[
        mockStreamFn.mock.calls[0][0].messages.length - 1
      ]?.content;
    expect(content).toContain("## s12 计划执行提醒");
    expect(content).toContain("请先用 todo 刷新当前短计划");
    expect(content).toContain("## s13 当前计划状态");
    expect(content).toContain("[>] 修复问题");
  });

  it("普通请求不会注入额外的 planning reminder", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: [],
      planningState: { items: [], roundsSinceUpdate: 0 },
      prompt: "解释这个函数",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const content =
      mockStreamFn.mock.calls[0][0].messages[
        mockStreamFn.mock.calls[0][0].messages.length - 1
      ]?.content;
    expect(content).not.toContain("## s12 计划执行提醒");
  });

  it("目录树工具把真实目录树返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield {
        type: "tool-call" as const,
        toolName: "browse",
        toolCallId: "call-tree-1",
        input: {},
      };
      yield {
        type: "tool-result" as const,
        toolName: "browse",
        toolCallId: "call-tree-1",
        output: {
          kind: "directory",
          name: "北境余烬",
          path: "C:/books/北境余烬",
          children: [
            { kind: "directory", name: "章节", path: "C:/books/北境余烬/章节" },
          ],
        },
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["browse"],
      prompt: "读取目录树",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        browse: {
          description: "读取当前工作区目录树",
          execute: async () => ({
            ok: true,
            summary: "已读取工作区 北境余烬",
            data: {
              kind: "directory",
              name: "北境余烬",
              path: "C:/books/北境余烬",
              children: [
                {
                  kind: "directory",
                  name: "章节",
                  path: "C:/books/北境余烬/章节",
                },
              ],
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
    expect(mockStreamFn.mock.calls[0][0].system).toContain(
      "优先传相对工作区根目录的路径",
    );
    expect(mockStreamFn.mock.calls[0][0].tools?.browse).toBeDefined();
    expect(parts).toEqual([
      {
        type: "tool-call",
        toolName: "browse",
        toolCallId: "call-tree-1",
        status: "running",
        inputSummary: "{}",
      },
      {
        type: "tool-result",
        toolName: "browse",
        toolCallId: "call-tree-1",
        status: "completed",
        output: {
          kind: "directory",
          name: "北境余烬",
          path: "C:/books/北境余烬",
          children: [
            { kind: "directory", name: "章节", path: "C:/books/北境余烬/章节" },
          ],
        },
        outputSummary:
          '{"kind":"directory","name":"北境余烬","path":"C:/books/北境余烬","children":[{"kind":"directory","name":"章节","path":"C:/books/北境余烬/章节"}]}',
      },
    ]);
  });

  it("path 工具会暴露给模型并返回迁移结果", async () => {
    async function* mockFullStream() {
      yield { type: "text-delta" as const, text: "收到" };
    }

    const executeMock = vi.fn().mockResolvedValue({
      ok: true,
      summary: "已迁移到 归档/第一卷/第001章.md",
    });
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["path"],
      prompt: "把章节移动到归档目录",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        path: {
          description: "迁移文件或文件夹",
          execute: executeMock,
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].system).toContain("path");
    const tool = mockStreamFn.mock.calls[0][0].tools?.path as
      | {
          execute?: (
            input: { action: "move"; path: string; targetParentPath: string },
            options: unknown,
          ) => Promise<unknown>;
        }
      | undefined;
    expect(tool).toBeDefined();

    await expect(
      tool?.execute?.(
        {
          action: "move",
          path: "草稿/第001章.md",
          targetParentPath: "归档/第一卷",
        },
        {} as never,
      ),
    ).resolves.toBe("已迁移到 归档/第一卷/第001章.md");

    expect(executeMock).toHaveBeenCalledWith(
      {
        action: "move",
        path: "草稿/第001章.md",
        targetParentPath: "归档/第一卷",
      },
      expect.objectContaining({
        requestId: expect.stringMatching(/^tool-path-/),
      }),
    );
  });

  it("skill 列表工具把结构化结果返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield {
        type: "tool-call" as const,
        toolName: "skill",
        toolCallId: "call-skills-1",
        input: {},
      };
      yield {
        type: "tool-result" as const,
        toolName: "skill",
        toolCallId: "call-skills-1",
        output: [
          {
            id: "chapter-write",
            name: "章节写作",
            description: "写作章节正文",
            sourceKind: "builtin-package",
            files: ["SKILL.md", "references/voice.md"],
          },
        ],
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["skill"],
      prompt: "列出本地技能",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        skill: {
          description: "列出技能",
          execute: async () => ({
            ok: true,
            summary: "已读取技能列表",
            data: [],
          }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].tools?.skill).toBeDefined();
    expect(parts).toEqual([
      {
        type: "tool-call",
        toolName: "skill",
        toolCallId: "call-skills-1",
        status: "running",
        inputSummary: "{}",
      },
      {
        type: "tool-result",
        toolName: "skill",
        toolCallId: "call-skills-1",
        status: "completed",
        output: [
          {
            id: "chapter-write",
            name: "章节写作",
            description: "写作章节正文",
            sourceKind: "builtin-package",
            files: ["SKILL.md", "references/voice.md"],
          },
        ],
        outputSummary:
          '[{"id":"chapter-write","name":"章节写作","description":"写作章节正文","sourceKind":"builtin-package","files":["SKILL.md","references/voice.md"]}]',
      },
    ]);
  });

  it("web_search 工具把结构化网络结果返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield {
        type: "tool-call" as const,
        toolName: "web_search",
        toolCallId: "call-web-search-1",
        input: { limit: 3, query: "番茄小说 最新规则" },
      };
      yield {
        type: "tool-result" as const,
        toolName: "web_search",
        toolCallId: "call-web-search-1",
        output: {
          success: true,
          query: "番茄小说 最新规则",
          provider: "searxng",
          instance: "https://search-a.example",
          totalCount: 1,
          results: [
            {
              url: "https://example.com/post-1",
              title: "规则更新",
              snippet: "这里是摘要",
              source: "https://example.com/post-1",
            },
          ],
        },
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["web_search"],
      prompt: "查一下番茄小说最新规则",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        web_search: {
          description: "网络搜索",
          execute: async () => ({
            ok: true,
            summary: "已完成网络搜索",
            data: {},
          }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].tools?.web_search).toBeDefined();
    expect(parts).toEqual([
      {
        type: "tool-call",
        toolName: "web_search",
        toolCallId: "call-web-search-1",
        status: "running",
        inputSummary: '{"limit":3,"query":"番茄小说 最新规则"}',
      },
      {
        type: "tool-result",
        toolName: "web_search",
        toolCallId: "call-web-search-1",
        status: "completed",
        output: {
          success: true,
          query: "番茄小说 最新规则",
          provider: "searxng",
          instance: "https://search-a.example",
          totalCount: 1,
          results: [
            {
              url: "https://example.com/post-1",
              title: "规则更新",
              snippet: "这里是摘要",
              source: "https://example.com/post-1",
            },
          ],
        },
        outputSummary:
          '{"success":true,"query":"番茄小说 最新规则","provider":"searxng","instance":"https://search-a.example","totalCount":1,"results":[{"url":"https://example.com/post-1","title":"规则更新","snippet":"这里是摘要","source":"https://example.com/post-1"}]}',
      },
    ]);
  });

  it("web_fetch 工具把网页正文结果返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield {
        type: "tool-call" as const,
        toolName: "web_fetch",
        toolCallId: "call-web-fetch-1",
        input: { url: "https://example.com/article-1" },
      };
      yield {
        type: "tool-result" as const,
        toolName: "web_fetch",
        toolCallId: "call-web-fetch-1",
        output: {
          success: true,
          url: "https://example.com/article-1",
          title: "年度盘点",
          content: "这里是网页正文。",
          excerpt: "这里是网页正文。",
          textLength: 8,
          truncated: false,
          provider: "direct_html",
        },
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["web_fetch"],
      prompt: "读一下这个网页",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        web_fetch: {
          description: "网页读取",
          execute: async () => ({
            ok: true,
            summary: "已读取网页",
            data: {},
          }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].tools?.web_fetch).toBeDefined();
    expect(parts).toEqual([
      {
        type: "tool-call",
        toolName: "web_fetch",
        toolCallId: "call-web-fetch-1",
        status: "running",
        inputSummary: '{"url":"https://example.com/article-1"}',
      },
      {
        type: "tool-result",
        toolName: "web_fetch",
        toolCallId: "call-web-fetch-1",
        status: "completed",
        output: {
          success: true,
          url: "https://example.com/article-1",
          title: "年度盘点",
          content: "这里是网页正文。",
          excerpt: "这里是网页正文。",
          textLength: 8,
          truncated: false,
          provider: "direct_html",
        },
        outputSummary:
          '{"success":true,"url":"https://example.com/article-1","title":"年度盘点","content":"这里是网页正文。","excerpt":"这里是网页正文。","textLength":8,"truncated":false,"provider":"direct_html"}',
      },
    ]);
  });

  it("连续多个同名工具调用时，每个完成状态都能正确回填", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield {
        type: "tool-call" as const,
        toolName: "read",
        toolCallId: "call-read-1",
        input: { path: "章节/第一章.md" },
      };
      yield {
        type: "tool-call" as const,
        toolName: "read",
        toolCallId: "call-read-2",
        input: { path: "章节/第二章.md" },
      };
      yield {
        type: "tool-result" as const,
        toolName: "read",
        toolCallId: "call-read-2",
        output: "已读取第二章",
      };
      yield {
        type: "tool-result" as const,
        toolName: "read",
        toolCallId: "call-read-1",
        output: "已读取第一章",
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read"],
      prompt: "连续读取章节",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read: {
          description: "读取文件",
          execute: async () => ({
            ok: true,
            summary: "已读取文件",
          }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(parts).toEqual([
      {
        type: "tool-call",
        toolName: "read",
        toolCallId: "call-read-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
      {
        type: "tool-call",
        toolName: "read",
        toolCallId: "call-read-2",
        status: "running",
        inputSummary: '{"path":"章节/第二章.md"}',
      },
      {
        type: "tool-result",
        toolName: "read",
        toolCallId: "call-read-2",
        status: "completed",
        output: "已读取第二章",
        outputSummary: "已读取第二章",
      },
      {
        type: "tool-result",
        toolName: "read",
        toolCallId: "call-read-1",
        status: "completed",
        output: "已读取第一章",
        outputSummary: "已读取第一章",
      },
    ]);
  });

  it("tool-result 缺少 toolCallId 时不会错误回填已有工具调用", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield {
        type: "tool-call" as const,
        toolName: "read",
        toolCallId: "call-read-1",
        input: { path: "章节/第一章.md" },
      };
      yield {
        type: "tool-result" as const,
        toolName: "read",
        toolCallId: "",
        output: "异常结果",
      };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read"],
      prompt: "测试异常结果",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read: {
          description: "读取文件",
          execute: async () => ({
            ok: true,
            summary: "已读取文件",
          }),
        },
      },
      _streamFn: mockStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    expect(parts).toEqual([
      {
        type: "tool-call",
        toolName: "read",
        toolCallId: "call-read-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
      {
        type: "tool-result",
        toolName: "read",
        toolCallId: "",
        status: "completed",
        output: "异常结果",
        outputSummary: "异常结果",
      },
    ]);
  });

  it("普通请求默认由主代理直接处理，不自动委派子代理", async () => {
    async function* mockMainFullStream() {
      yield { type: "text-delta" as const, text: "主代理直接完成回复。" };
    }

    const mockSubagentStreamFn = vi.fn();
    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockMainFullStream(),
    });
    const enabledAgent: ResolvedAgent = {
      id: "plot-agent",
      name: "剧情代理",
      description: "负责剧情推进",
      role: "剧情",
      tags: ["剧情", "动机"],
      sourceLabel: "内置",
      body: "专注处理剧情与人物动机。",
      suggestedTools: ["read"],
      enabled: true,
      files: ["manifest.json", "AGENTS.md"],
      sourceKind: "builtin-package",
      dispatchHint: "当用户询问剧情推进时",
      validation: { errors: [], isValid: true, warnings: [] },
      discoveredAt: 1,
      isBuiltin: true,
      manifestFilePath: "agents/plot-agent/manifest.json",
    };

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["read"],
      prompt: "继续写这一章",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read: {
          description: "读取文件",
          execute: async () => ({
            ok: true,
            summary: "已读取当前章节",
          }),
        },
      },
      _streamFn: mockStreamFn,
      _subagentStreamFn: mockSubagentStreamFn as unknown as typeof mockStreamFn,
    });

    const parts: AgentPart[] = [];
    for await (const part of stream) {
      parts.push(part);
    }

    expect(mockSubagentStreamFn).not.toHaveBeenCalled();
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(parts).toEqual([
      { type: "text-delta", delta: "主代理直接完成回复。" },
    ]);
    expect(mockStreamFn.mock.calls[0][0].messages[0].content).not.toContain(
      "子任务摘要",
    );
  });

  it("支持通过 task 工具主动派发子代理并回传摘要", async () => {
    const parts: AgentPart[] = [];

    async function* mockSubagentFullStream() {
      yield { type: "reasoning-delta" as const, text: "正在分析人物动机。" };
      yield {
        type: "tool-call" as const,
        toolName: "read",
        toolCallId: "sub-call-1",
        input: { path: "章节/第一章.md" },
      };
      yield {
        type: "tool-result" as const,
        toolName: "read",
        toolCallId: "sub-call-1",
        output: "已读取当前章节",
      };
      yield { type: "text-delta" as const, text: "建议先补一段主角迟疑。" };
    }

    const mockSubagentStreamFn = vi.fn().mockReturnValue({
      fullStream: mockSubagentFullStream(),
    });
    const mockStreamFn = vi
      .fn()
      .mockImplementation(
        (request: {
          tools?: Record<
            string,
            {
              execute?: (
                input: { prompt: string; agentId?: string },
                options: unknown,
              ) => Promise<unknown>;
            }
          >;
        }) => {
          const taskTool = request.tools?.task;
          return {
            fullStream: (async function* () {
              yield {
                type: "tool-call" as const,
                toolName: "task",
                toolCallId: "task-call-1",
                input: { prompt: "帮我分析主角动机", agentId: "plot-agent" },
              };
              const output = await taskTool?.execute?.(
                { prompt: "帮我分析主角动机", agentId: "plot-agent" },
                {} as never,
              );
              yield {
                type: "tool-result" as const,
                toolName: "task",
                toolCallId: "task-call-1",
                output: output ?? "",
              };
              yield {
                type: "text-delta" as const,
                text: "主代理已整合子代理建议。",
              };
            })(),
          };
        },
      );
    const enabledAgent: ResolvedAgent = {
      id: "plot-agent",
      name: "剧情代理",
      description: "负责剧情推进",
      role: "剧情",
      tags: ["剧情", "动机"],
      sourceLabel: "内置",
      body: "专注处理剧情与人物动机。",
      suggestedTools: ["read"],
      enabled: true,
      files: ["manifest.json", "AGENTS.md"],
      sourceKind: "builtin-package",
      dispatchHint: "当用户询问剧情推进时",
      validation: { errors: [], isValid: true, warnings: [] },
      discoveredAt: 1,
      isBuiltin: true,
      manifestFilePath: "agents/plot-agent/manifest.json",
    };

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["read", "task"],
      prompt: "帮我分析主角动机",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read: {
          description: "读取文件",
          execute: async () => ({
            ok: true,
            summary: "已读取当前章节",
          }),
        },
      },
      _streamFn: mockStreamFn,
      _subagentStreamFn: mockSubagentStreamFn,
    });

    for await (const part of stream) {
      parts.push(part);
    }

    const subagentParts = parts.filter(
      (part): part is Extract<AgentPart, { type: "subagent" }> =>
        part.type === "subagent",
    );
    expect(subagentParts.length).toBeGreaterThan(0);
    expect(new Set(subagentParts.map((part) => part.id)).size).toBe(1);
    expect(subagentParts[0]).toMatchObject({
      type: "subagent",
      status: "running",
      summary: "已派发子任务：剧情代理",
      parts: [],
    });
    expect(subagentParts[3].parts).toEqual([
      { type: "reasoning", summary: "正在思考", detail: "正在分析人物动机。" },
      {
        type: "tool-call",
        toolName: "read",
        toolCallId: "sub-call-1",
        status: "completed",
        inputSummary: '{"path":"章节/第一章.md"}',
        output: "已读取当前章节",
        outputSummary: "已读取当前章节",
      },
    ]);
    expect(subagentParts[5]).toMatchObject({
      status: "completed",
      summary: "剧情代理 子任务已完成",
      detail: "建议先补一段主角迟疑。",
    });
    expect(subagentParts[5].parts[subagentParts[5].parts.length - 1]).toEqual({
      type: "text",
      text: "建议先补一段主角迟疑。",
    });
    expect(parts).toContainEqual({
      type: "tool-call",
      toolName: "task",
      toolCallId: "task-call-1",
      status: "running",
      inputSummary: '{"prompt":"帮我分析主角动机","agentId":"plot-agent"}',
    });
    const taskResult = parts.find(
      (part): part is Extract<AgentPart, { type: "tool-result" }> =>
        part.type === "tool-result" &&
        part.toolName === "task" &&
        part.toolCallId === "task-call-1",
    );
    expect(taskResult).toBeDefined();
    expect(taskResult?.status).toBe("completed");
    expect(taskResult?.output).toMatchObject({
      agentId: "plot-agent",
      agentName: "剧情代理",
    });
    expect(taskResult?.outputSummary).toContain('"agentId":"plot-agent"');
    expect(taskResult?.outputSummary).toContain('"agentName":"剧情代理"');
    expect(taskResult?.outputSummary).toContain(
      '"summary":"建议先补一段主角迟疑。"',
    );
    expect(taskResult?.outputSummary).toContain(
      '"subagentId":"subagent-plot-agent-',
    );
    expect(parts[parts.length - 1]).toEqual({
      type: "text-delta",
      delta: "主代理已整合子代理建议。",
    });
    expect(mockSubagentStreamFn).toHaveBeenCalledTimes(1);
    expect(mockSubagentStreamFn.mock.calls[0][0].maxSteps).toBeUndefined();
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].messages[0].content).not.toContain(
      "## s11 子任务摘要（剧情代理）",
    );
  });

  it("子代理继承已启用的写入与结构工具", async () => {
    async function* mockSubagentFullStream() {
      yield { type: "text-delta" as const, text: "子代理已收到工具集。" };
    }

    const mockSubagentStreamFn = vi.fn().mockReturnValue({
      fullStream: mockSubagentFullStream(),
    });
    const mockStreamFn = vi
      .fn()
      .mockImplementation(
        (request: {
          tools?: Record<
            string,
            {
              execute?: (
                input: { prompt: string; agentId?: string },
                options: unknown,
              ) => Promise<unknown>;
            }
          >;
        }) => {
          const taskTool = request.tools?.task;
          return {
            fullStream: (async function* () {
              yield {
                type: "tool-call" as const,
                toolName: "task",
                toolCallId: "task-call-write-1",
                input: { prompt: "请生成报告并删除旧文件", agentId: "plot-agent" },
              };
              const output = await taskTool?.execute?.(
                { prompt: "请生成报告并删除旧文件", agentId: "plot-agent" },
                {} as never,
              );
              yield {
                type: "tool-result" as const,
                toolName: "task",
                toolCallId: "task-call-write-1",
                output: output ?? "",
              };
            })(),
          };
        },
      );
    const enabledAgent: ResolvedAgent = {
      id: "plot-agent",
      name: "剧情代理",
      description: "负责剧情推进",
      role: "剧情",
      tags: ["剧情", "动机"],
      sourceLabel: "内置",
      body: "专注处理剧情与人物动机。",
      suggestedTools: ["read", "write", "path", "json"],
      enabled: true,
      files: ["manifest.json", "AGENTS.md"],
      sourceKind: "builtin-package",
      dispatchHint: "当用户询问剧情推进时",
      validation: { errors: [], isValid: true, warnings: [] },
      discoveredAt: 1,
      isBuiltin: true,
      manifestFilePath: "agents/plot-agent/manifest.json",
    };

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["task", "write", "json", "path"],
      prompt: "请生成报告并删除旧文件",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        write: {
          description: "写入文件",
          execute: async () => ({ ok: true, summary: "已写入报告" }),
        },
        json: {
          description: "更新 JSON",
          execute: async () => ({ ok: true, summary: "已更新 JSON", data: {} }),
        },
        path: {
          description: "处理路径",
          execute: async () => ({ ok: true, summary: "已删除旧文件" }),
        },
      },
      _streamFn: mockStreamFn,
      _subagentStreamFn: mockSubagentStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    expect(mockSubagentStreamFn).toHaveBeenCalledTimes(1);
    const subagentTools = mockSubagentStreamFn.mock.calls[0][0].tools;
    expect(subagentTools?.write).toBeDefined();
    expect(subagentTools?.json).toBeDefined();
    expect(subagentTools?.path).toBeDefined();
    expect(subagentTools?.task).toBeUndefined();
  });
});
