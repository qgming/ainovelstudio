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
      enabledAgents: [],
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
      enabledAgents: [],
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
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
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
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
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
    expect(request.messages[0].content).toContain("## s13 用户请求");
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
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
      },
      workspaceTools: {},
      _streamFn: mockStreamFn,
    });

    for await (const _part of stream) {
      // drain stream
    }

    const request = mockStreamFn.mock.calls[0][0];
    expect(request.messages[0].content).toContain("## s12 手动指定上下文");
    expect(request.messages[0].content).toContain("### 手动指定技能");
    expect(request.messages[0].content).toContain("剧情规划：拆解冲突和节奏。");
    expect(request.messages[0].content).toContain("### 手动指定子代理");
    expect(request.messages[0].content).toContain("续写代理（续写与润色）：负责续写章节。");
    expect(request.messages[0].content).toContain("### 手动指定文件");
    expect(request.messages[0].content).toContain("#### 人物.md");
    expect(request.messages[0].content).toContain("主角：林燃");
    expect(request.messages[0].content).toContain("## s13 用户请求");
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
      enabledAgents: [],
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

  it("skills 列表工具把结构化结果返回给模型", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "tool-call" as const, toolName: "list_skills", input: {} };
      yield {
        type: "tool-result" as const,
        toolName: "list_skills",
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
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
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
      { type: "tool-call", toolName: "list_skills", status: "running", inputSummary: "{}" },
      {
        type: "tool-result",
        toolName: "list_skills",
        status: "completed",
        outputSummary:
          '[{"id":"chapter-write","name":"章节写作","description":"写作章节正文","sourceKind":"builtin-package","files":["SKILL.md","references/voice.md"]}]',
      },
    ]);
  });

  it("连续多个同名工具调用时，每个完成状态都能正确回填", async () => {
    const parts: AgentPart[] = [];

    async function* mockFullStream() {
      yield { type: "tool-call" as const, toolName: "read_file", input: { path: "章节/第一章.md" } };
      yield { type: "tool-call" as const, toolName: "read_file", input: { path: "章节/第二章.md" } };
      yield { type: "tool-result" as const, toolName: "read_file", output: "已读取第一章" };
      yield { type: "tool-result" as const, toolName: "read_file", output: "已读取第二章" };
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
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
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
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
      {
        type: "tool-call",
        toolName: "read_file",
        status: "running",
        inputSummary: '{"path":"章节/第二章.md"}',
      },
      {
        type: "tool-result",
        toolName: "read_file",
        status: "completed",
        outputSummary: "已读取第一章",
      },
      {
        type: "tool-result",
        toolName: "read_file",
        status: "completed",
        outputSummary: "已读取第二章",
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
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
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

  it("支持子代理预分析并把过程映射为 subagent part", async () => {
    const parts: AgentPart[] = [];

    async function* mockSubagentFullStream() {
      yield { type: "reasoning-delta" as const, text: "正在分析人物动机。" };
      yield { type: "tool-call" as const, toolName: "read_file", input: { path: "章节/第一章.md" } };
      yield { type: "tool-result" as const, toolName: "read_file", output: "已读取当前章节" };
      yield { type: "text-delta" as const, text: "建议先补一段主角迟疑。" };
    }

    async function* mockMainFullStream() {
      yield { type: "text-delta" as const, text: "主代理已整合子代理建议。" };
    }

    const mockSubagentStreamFn = vi.fn().mockReturnValue({
      fullStream: mockSubagentFullStream(),
    });
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
      workspaceRootPath: "C:/books/北境余烬",
      enabledAgents: [enabledAgent],
      enabledSkills: [],
      enabledToolIds: ["read_file"],
      prompt: "帮我分析主角动机",
      providerConfig: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "test-model",
        temperature: 0.7,
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
    expect(subagentParts).toHaveLength(6);
    expect(new Set(subagentParts.map((part) => part.id)).size).toBe(1);
    expect(subagentParts[0]).toMatchObject({
      type: "subagent",
      status: "running",
      summary: "已派发子任务：剧情代理",
      parts: [],
    });
    expect(subagentParts[3].parts).toEqual([
      { type: "reasoning", summary: "思考中...", detail: "正在分析人物动机。" },
      {
        type: "tool-call",
        toolName: "read_file",
        status: "completed",
        inputSummary: '{"path":"章节/第一章.md"}',
        outputSummary: "已读取当前章节",
      },
    ]);
    expect(subagentParts[5]).toMatchObject({
      status: "completed",
      summary: "剧情代理 子任务已完成",
      detail: "建议先补一段主角迟疑。",
    });
    expect(subagentParts[5].parts.at(-1)).toEqual({ type: "text", text: "建议先补一段主角迟疑。" });
    expect(parts.at(-1)).toEqual({ type: "text-delta", delta: "主代理已整合子代理建议。" });
    expect(mockSubagentStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockStreamFn.mock.calls[0][0].messages[0].content).toContain("## s11 子任务摘要（剧情代理）");
  });
});


