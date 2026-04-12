import { describe, expect, it, vi } from "vitest";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "./promptContext";
import { runAgentTurn } from "./session";
import type { AgentPart } from "./types";

describe("agent session (streaming)", () => {
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
      enabledToolIds: ["read_file"],
      prompt: "读取文件",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read_file: {
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

    const tool = mockStreamFn.mock.calls[0][0].tools?.read_file as
      | { execute?: (input: { path: string }, options: unknown) => Promise<unknown> }
      | undefined;
    expect(tool).toBeDefined();

    const pending = tool?.execute?.({ path: "章节/第一章.md" }, {} as never);
    expect(pending).toBeDefined();
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    resolveTool?.({ ok: true, summary: "已读取当前章节" });
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
    expect(request.messages[0]).toEqual({ role: "user", content: "先总结上一章" });
    expect(request.messages[1]).toEqual({
      role: "assistant",
      content: "上一章的核心冲突是主角是否进城。",
    });
    expect(request.messages[2].role).toBe("user");
    expect(request.messages[2].content).toContain("继续分析第二章");
    expect(request.messages[2].content).toContain("- 当前工作区：C:/books/北境余烬");
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
            { type: "tool-call", toolName: "read_file", toolCallId: "call-history-1", status: "completed", inputSummary: "{\"path\":\"设定/人物.md\"}" },
            { type: "tool-result", toolName: "read_file", toolCallId: "call-history-1", status: "completed", outputSummary: "主角：林燃；目标：逃离北城" },
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
        "工具调用 [call-history-1] read_file",
        "输入摘要：{\"path\":\"设定/人物.md\"}",
        "",
        "工具结果 [call-history-1] read_file",
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
    expect(request.messages[0].content).toContain("- 当前工作区：C:/books/北境余烬");
    expect(request.messages[0].content).toContain("- 当前激活文件：章节/第一章.md");
    expect(request.messages[0].content).toContain("- 当前文件类型：章节/正文稿件");
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
        skills: [{ id: "plot-skill", name: "剧情规划", description: "拆解冲突和节奏。" }],
        agents: [{ id: "writer-agent", name: "续写代理", description: "负责续写章节。", role: "续写与润色" }],
        files: [{ path: "设定/人物.md", name: "人物.md", content: "主角：林燃\n目标：逃离北城" }],
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
    expect(request.messages[0].content).toContain("## s14 手动指定上下文");
    expect(request.messages[0].content).toContain("### 手动指定技能");
    expect(request.messages[0].content).toContain("剧情规划：拆解冲突和节奏。");
    expect(request.messages[0].content).toContain("### 手动指定子代理");
    expect(request.messages[0].content).toContain("续写代理（续写与润色）：负责续写章节。");
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

    const content = mockStreamFn.mock.calls[0][0].messages[mockStreamFn.mock.calls[0][0].messages.length - 1]?.content;
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
        items: [{ content: "修复问题", status: "in_progress", activeForm: "正在修复问题" }],
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

    const content = mockStreamFn.mock.calls[0][0].messages[mockStreamFn.mock.calls[0][0].messages.length - 1]?.content;
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

    const content = mockStreamFn.mock.calls[0][0].messages[mockStreamFn.mock.calls[0][0].messages.length - 1]?.content;
    expect(content).not.toContain("## s12 计划执行提醒");
  });

  it("目录树工具把真实目录树返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "tool-call" as const, toolName: "read_workspace_tree", toolCallId: "call-tree-1", input: {} };
      yield {
        type: "tool-result" as const,
        toolName: "read_workspace_tree",
        toolCallId: "call-tree-1",
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
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read_workspace_tree"],
      prompt: "读取目录树",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
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
    expect(mockStreamFn.mock.calls[0][0].system).toContain("优先传相对工作区根目录的路径");
    expect(mockStreamFn.mock.calls[0][0].tools?.read_workspace_tree).toBeDefined();
      expect(parts).toEqual([
      { type: "tool-call", toolName: "read_workspace_tree", toolCallId: "call-tree-1", status: "running", inputSummary: "{}" },
        {
          type: "tool-result",
          toolName: "read_workspace_tree",
          toolCallId: "call-tree-1",
          status: "completed",
          output: {
            kind: "directory",
            name: "北境余烬",
            path: "C:/books/北境余烬",
            children: [{ kind: "directory", name: "章节", path: "C:/books/北境余烬/章节" }],
          },
          outputSummary:
            '{"kind":"directory","name":"北境余烬","path":"C:/books/北境余烬","children":[{"kind":"directory","name":"章节","path":"C:/books/北境余烬/章节"}]}',
        },
    ]);
  });

  it("skills 列表工具把结构化结果返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "tool-call" as const, toolName: "list_skills", toolCallId: "call-skills-1", input: {} };
      yield {
        type: "tool-result" as const,
        toolName: "list_skills",
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
      enabledToolIds: ["list_skills"],
      prompt: "列出本地技能",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        list_skills: {
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
    expect(mockStreamFn.mock.calls[0][0].tools?.list_skills).toBeDefined();
      expect(parts).toEqual([
      { type: "tool-call", toolName: "list_skills", toolCallId: "call-skills-1", status: "running", inputSummary: "{}" },
        {
          type: "tool-result",
          toolName: "list_skills",
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

  it("连续多个同名工具调用时，每个完成状态都能正确回填", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "tool-call" as const, toolName: "read_file", toolCallId: "call-read-1", input: { path: "章节/第一章.md" } };
      yield { type: "tool-call" as const, toolName: "read_file", toolCallId: "call-read-2", input: { path: "章节/第二章.md" } };
      yield { type: "tool-result" as const, toolName: "read_file", toolCallId: "call-read-2", output: "已读取第二章" };
      yield { type: "tool-result" as const, toolName: "read_file", toolCallId: "call-read-1", output: "已读取第一章" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read_file"],
      prompt: "连续读取章节",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read_file: {
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
        toolName: "read_file",
        toolCallId: "call-read-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "call-read-2",
        status: "running",
        inputSummary: '{"path":"章节/第二章.md"}',
      },
      {
        type: "tool-result",
        toolName: "read_file",
        toolCallId: "call-read-2",
        status: "completed",
        output: "已读取第二章",
        outputSummary: "已读取第二章",
      },
      {
        type: "tool-result",
        toolName: "read_file",
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
      yield { type: "tool-call" as const, toolName: "read_file", toolCallId: "call-read-1", input: { path: "章节/第一章.md" } };
      yield { type: "tool-result" as const, toolName: "read_file", toolCallId: "", output: "异常结果" };
    }

    const mockStreamFn = vi.fn().mockReturnValue({
      fullStream: mockFullStream(),
    });

    const stream = runAgentTurn({
      activeFilePath: null,
      enabledAgents: [],
      enabledSkills: [],
      enabledToolIds: ["read_file"],
      prompt: "测试异常结果",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read_file: {
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
        toolName: "read_file",
        toolCallId: "call-read-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
      {
        type: "tool-result",
        toolName: "read_file",
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
      toolsPreview: "可读取章节文件",
      memoryPreview: "记住当前故事走向",
      suggestedTools: ["read_file"],
      enabled: true,
      files: ["AGENTS.md", "TOOLS.md", "MEMORY.md"],
      sourceKind: "builtin-package",
      dispatchHint: "当用户询问剧情推进时",
      validation: { errors: [], isValid: true, warnings: [] },
      discoveredAt: Date.now(),
      isBuiltin: true,
      rawMarkdown: "# 剧情代理",
    };

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["read_file"],
      prompt: "继续写这一章",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read_file: {
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
    expect(parts).toEqual([{ type: "text-delta", delta: "主代理直接完成回复。" }]);
    expect(mockStreamFn.mock.calls[0][0].messages[0].content).not.toContain("子任务摘要");
  });

  it("支持通过 task 工具主动派发子代理并回传摘要", async () => {
    const parts: AgentPart[] = [];

    async function* mockSubagentFullStream() {
      yield { type: "reasoning-delta" as const, text: "正在分析人物动机。" };
      yield { type: "tool-call" as const, toolName: "read_file", toolCallId: "sub-call-1", input: { path: "章节/第一章.md" } };
      yield { type: "tool-result" as const, toolName: "read_file", toolCallId: "sub-call-1", output: "已读取当前章节" };
      yield { type: "text-delta" as const, text: "建议先补一段主角迟疑。" };
    }

    const mockSubagentStreamFn = vi.fn().mockReturnValue({
      fullStream: mockSubagentFullStream(),
    });
    const mockStreamFn = vi.fn().mockImplementation((request: { tools?: Record<string, { execute?: (input: { prompt: string; agentId?: string }, options: unknown) => Promise<unknown> }> }) => {
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
          yield { type: "text-delta" as const, text: "主代理已整合子代理建议。" };
        })(),
      };
    });
    const enabledAgent: ResolvedAgent = {
      id: "plot-agent",
      name: "剧情代理",
      description: "负责剧情推进",
      role: "剧情",
      tags: ["剧情", "动机"],
      sourceLabel: "内置",
      body: "专注处理剧情与人物动机。",
      toolsPreview: "可读取章节文件",
      memoryPreview: "记住当前故事走向",
      suggestedTools: ["read_file"],
      enabled: true,
      files: ["AGENTS.md", "TOOLS.md", "MEMORY.md"],
      sourceKind: "builtin-package",
      dispatchHint: "当用户询问剧情推进时",
      validation: { errors: [], isValid: true, warnings: [] },
      discoveredAt: Date.now(),
      isBuiltin: true,
      rawMarkdown: "# 剧情代理",
    };

    const stream = runAgentTurn({
      activeFilePath: "章节/第一章.md",
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["read_file", "task"],
      prompt: "帮我分析主角动机",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        model: "test-model",
      },
      workspaceTools: {
        read_file: {
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

    const subagentParts = parts.filter((part): part is Extract<AgentPart, { type: "subagent" }> => part.type === "subagent");
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
        toolName: "read_file",
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
    expect(subagentParts[5].parts[subagentParts[5].parts.length - 1]).toEqual({ type: "text", text: "建议先补一段主角迟疑。" });
    expect(parts).toContainEqual({
      type: "tool-call",
      toolName: "task",
      toolCallId: "task-call-1",
      status: "running",
      inputSummary: '{"prompt":"帮我分析主角动机","agentId":"plot-agent"}',
    });
    const taskResult = parts.find(
      (part): part is Extract<AgentPart, { type: "tool-result" }> =>
        part.type === "tool-result" && part.toolName === "task" && part.toolCallId === "task-call-1",
    );
    expect(taskResult).toBeDefined();
    expect(taskResult?.status).toBe("completed");
    expect(taskResult?.output).toMatchObject({
      agentId: "plot-agent",
      agentName: "剧情代理",
    });
    expect(taskResult?.outputSummary).toContain('"agentId":"plot-agent"');
    expect(taskResult?.outputSummary).toContain('"agentName":"剧情代理"');
    expect(taskResult?.outputSummary).toContain('"summary":"建议先补一段主角迟疑。"');
    expect(taskResult?.outputSummary).toContain('"subagentId":"subagent-plot-agent-');
    expect(parts[parts.length - 1]).toEqual({ type: "text-delta", delta: "主代理已整合子代理建议。" });
    expect(mockSubagentStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].messages[0].content).not.toContain("## s11 子任务摘要（剧情代理）");
  });
});


