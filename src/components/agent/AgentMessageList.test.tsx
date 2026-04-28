import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookAgentPanel } from "../book/BookAgentPanel";
import { AgentMessageList } from "./AgentMessageList";
import { useAgentStore } from "../../stores/agentStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";
import { useSkillsStore } from "../../stores/skillsStore";
import { useSubAgentStore } from "../../stores/subAgentStore";

describe("BookAgentPanel", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useBookWorkspaceStore.setState({
      activeFilePath: null,
      confirmState: null,
      draftContent: "",
      errorMessage: null,
      expandedPaths: [],
      hasInitialized: false,
      isBusy: false,
      isDirty: false,
      promptState: null,
      rootNode: null,
      rootPath: null,
    });
    useSkillsStore.setState({
      errorMessage: null,
      lastScannedAt: null,
      manifests: [],
      preferences: { enabledById: {} },
      status: "idle",
    });
    useSubAgentStore.setState({
      errorMessage: null,
      lastScannedAt: null,
      manifests: [],
      preferences: { enabledById: {} },
      status: "idle",
    });
    useAgentSettingsStore.setState({
      config: {
        apiKey: "",
        baseURL: "",
        model: "",
        enableReasoningEffort: false,
        reasoningEffort: "xhigh",
        simulateOpencodeBeta: false,
      },
      errorMessage: null,
      status: "idle",
    });
  });

  it("初始状态下渲染新的顶部结构和输入框", () => {
    render(<BookAgentPanel width={420} />);

    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开会话上下文" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "鞭策" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开历史记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始新对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择技能或子 Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择工作区文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeInTheDocument();
    expect(screen.getByLabelText("Agent 输入框")).toBeInTheDocument();
    expect(screen.queryByText("未配置模型")).not.toBeInTheDocument();
    expect(screen.queryByText("空闲")).not.toBeInTheDocument();
    expect(screen.queryByText("思考")).not.toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("点击会话上下文按钮后显示当前会话与 token 占用", () => {
    useAgentSettingsStore.setState({
      config: {
        apiKey: "",
        baseURL: "https://example.com/v1",
        model: "fallback-model",
        enableReasoningEffort: false,
        reasoningEffort: "xhigh",
        simulateOpencodeBeta: false,
      },
    });
    useAgentStore.setState({
      activeSessionId: "session-1",
      run: {
        id: "session-1",
        status: "completed",
        title: "北境收束",
        messages: [
          {
            id: "user-1",
            role: "user",
            author: "你",
            parts: [{ type: "text", text: "继续优化这一段" }],
          },
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            meta: {
              usage: {
                recordedAt: "1714557600",
                provider: "ainovelstudio-provider",
                modelId: "mimo-v2-pro-free",
                finishReason: "stop",
                inputTokens: 127,
                outputTokens: 215,
                totalTokens: 99_103,
                noCacheTokens: 127,
                cacheReadTokens: 98_752,
                cacheWriteTokens: 0,
                reasoningTokens: 9,
              },
            },
            parts: [{ type: "text", text: "这里是优化后的段落。" }],
          },
        ],
      },
      sessions: [
        {
          id: "session-1",
          title: "北境收束",
          summary: "这里是优化后的段落。",
          status: "completed",
          createdAt: "1714556400",
          updatedAt: "1714557600",
          lastMessageAt: "1714557600",
          pinned: false,
          archived: false,
        },
      ],
    });

    render(<BookAgentPanel width={420} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "打开会话上下文" }), { button: 0 });

    expect(screen.getByText("北境收束")).toBeInTheDocument();
    expect(screen.getByText("mimo-v2-pro-free")).toBeInTheDocument();
    expect(screen.getAllByText("99,103")).toHaveLength(2);
    expect(screen.getByText("98,752 / 0")).toBeInTheDocument();
    expect(screen.getByText("上下文拆分")).toBeInTheDocument();
    expect(screen.getByText(/缓存命中 99.6%/)).toBeInTheDocument();
  });

  it("支持打开技能和子 Agent 选择器", () => {
    useBookWorkspaceStore.setState({
      rootNode: {
        kind: "directory",
        name: "北境余烬",
        path: "北境余烬",
        children: [
          {
            kind: "directory",
            name: "章节",
            path: "章节",
            children: [{ kind: "file", name: "第一章.md", path: "章节/第一章.md" }],
          },
        ],
      },
    });
    useSkillsStore.setState({
      manifests: [
        {
          id: "plot-skill",
          name: "剧情规划",
          description: "拆解章节冲突与节奏。",
          body: "",
          discoveredAt: 1,
          rawMarkdown: "",
          isBuiltin: true,
          references: [],
          sourceKind: "builtin-package",
          suggestedTools: [],
          tags: ["plot"],
          validation: { errors: [], isValid: true, warnings: [] },
          defaultEnabled: true,
        },
      ],
      preferences: { enabledById: {} },
    });
    useSubAgentStore.setState({
      manifests: [
        {
          id: "writer-agent",
          name: "续写代理",
          description: "负责续写章节。",
          body: "",
          discoveredAt: 1,
          isBuiltin: true,
          manifestFilePath: "agents/writer-agent/manifest.json",
          role: "擅长续写与润色",
          sourceKind: "builtin-package",
          suggestedTools: [],
          tags: ["writer"],
          validation: { errors: [], isValid: true, warnings: [] },
          defaultEnabled: true,
        },
      ],
      preferences: { enabledById: {} },
    });

    render(<BookAgentPanel width={420} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "选择技能或子 Agent" }), { button: 0 });

    expect(screen.getByRole("button", { name: /剧情规划/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /续写代理/ })).toBeInTheDocument();
  });

  it("点击历史按钮后在触发位置弹出会话菜单", () => {
    useAgentStore.setState({
      activeSessionId: "session-1",
      sessions: [
        {
          id: "session-1",
          title: "当前剧情讨论",
          summary: "继续完善高潮戏。",
          status: "completed",
          createdAt: "10",
          updatedAt: "20",
          lastMessageAt: "20",
          pinned: false,
          archived: false,
        },
        {
          id: "session-2",
          title: "人物关系梳理",
          summary: "补充反派动机。",
          status: "idle",
          createdAt: "8",
          updatedAt: "12",
          lastMessageAt: "12",
          pinned: false,
          archived: false,
        },
      ],
      run: {
        id: "session-1",
        status: "completed",
        title: "当前剧情讨论",
        messages: [],
      },
    });

    render(<BookAgentPanel width={420} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "打开历史记录" }), { button: 0 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "当前剧情讨论" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "人物关系梳理" })).toBeInTheDocument();
    expect(screen.queryByText("历史会话")).not.toBeInTheDocument();
  });

  it("工具运行中与完成后使用同一个工具卡片展示状态", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "tool-call",
                toolName: "read_workspace_tree",
                toolCallId: "call-msg-1",
                status: "running",
                inputSummary: "{}",
              },
            ],
          },
        ],
      },
    });

    const { rerender } = render(<BookAgentPanel width={420} />);

    expect(screen.getByText("read_workspace_tree")).toBeInTheDocument();
    expect(screen.getByLabelText("运行中")).toBeInTheDocument();
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();

    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "tool-call",
                toolName: "read_workspace_tree",
                toolCallId: "call-msg-1",
                status: "completed",
                inputSummary: "{}",
                outputSummary: '{"name":"北境余烬","children":[{"name":"章节"}]}',
              },
            ],
          },
        ],
      },
    });

    rerender(<BookAgentPanel width={420} />);

    expect(screen.getByLabelText("运行成功")).toBeInTheDocument();
    expect(screen.queryByText("运行成功")).not.toBeInTheDocument();
    expect(screen.queryAllByText("read_workspace_tree")).toHaveLength(1);
  });

  it("运行中时显示停止按钮并可终止输出", async () => {
    const abort = vi.fn();
    useAgentStore.setState({
      abortController: { abort, signal: { aborted: false } } as unknown as AbortController,
      inflightToolRequestIds: ["tool-read-1", "tool-search-2"],
      run: {
        id: "run-test",
        status: "running",
        title: "",
        messages: [],
      },
    });

    render(<BookAgentPanel width={420} />);

    const stopButton = screen.getByRole("button", { name: "停止输出" });
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);

    expect(abort).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(useAgentStore.getState().inflightToolRequestIds).toEqual([]);
  });

  it("activeRunRequestId 存在时即使 run.status 暂时不是 running 也保持运行态 UI", () => {
    const abort = vi.fn();
    useAgentStore.setState({
      activeRunRequestId: "run-active",
      abortController: { abort, signal: { aborted: false } } as unknown as AbortController,
      run: {
        id: "run-test",
        status: "idle",
        title: "",
        messages: [],
      },
    });

    render(<BookAgentPanel width={420} />);

    expect(screen.getByRole("button", { name: "停止输出" })).toBeInTheDocument();
    expect(screen.getByText("正在思考")).toBeInTheDocument();
  });

  it("手动设置消息后可以渲染特殊 part 卡片", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "user-1",
            role: "user",
            author: "你",
            parts: [{ type: "text", text: "请帮我续写" }],
          },
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              { type: "text", text: "正在处理..." },
              { type: "tool-call", toolName: "read_file", toolCallId: "call-msg-2", status: "completed", inputSummary: "读取章节" },
            ],
          },
        ],
      },
    });

    render(<BookAgentPanel width={420} />);

    expect(screen.getByText("请帮我续写")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("发送后立即在底部显示正在思考", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "running",
        title: "",
        messages: [
          {
            id: "user-1",
            role: "user",
            author: "你",
            parts: [{ type: "text", text: "继续扩写这一章" }],
          },
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [{ type: "placeholder", text: "正在思考" }],
          },
        ],
      },
    });

    render(<BookAgentPanel width={420} />);

    expect(screen.getByText("正在思考")).toBeInTheDocument();
  });

  it("调用工具期间仍在底部持续显示正在思考", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "running",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "tool-call",
                toolName: "read_file",
                toolCallId: "call-msg-3",
                status: "running",
                inputSummary: '{"path":"章节/第一章.md"}',
              },
            ],
          },
        ],
      },
    });

    render(<BookAgentPanel width={420} />);

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("正在思考")).toBeInTheDocument();
  });

  it("支持 Markdown 渲染用户与 assistant 文本", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "user-1",
            role: "user",
            author: "你",
            parts: [{ type: "text", text: "**粗体用户**\n\n- 条目一" }],
          },
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [{ type: "text", text: "# 标题\n\n```ts\nconst value = 1\n```" }],
          },
        ],
      },
    });

    render(<BookAgentPanel width={420} />);

    expect(screen.getByText("粗体用户").tagName).toBe("STRONG");
    expect(screen.getByText("条目一").tagName).toBe("LI");
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    const codeBlock = screen.getByText("const value = 1");
    expect(codeBlock.tagName).toBe("CODE");
    expect(codeBlock.closest("pre")).not.toBeNull();
  });

  it("子代理卡片展开后显示带摘要的时间线", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "subagent",
                id: "subagent-1",
                name: "剧情代理",
                status: "completed",
                summary: "剧情代理已完成分析",
                detail: "建议提前铺垫主角动机。",
                parts: [
                  {
                    type: "reasoning",
                    summary: "正在思考",
                    detail: "正在分析冲突走向，准备判断主角动机是否需要提前铺垫，并整理后续节奏。",
                  },
                  {
                    type: "tool-call",
                    toolName: "read_file",
                    toolCallId: "call-msg-4",
                    status: "completed",
                    inputSummary: '{"path":"章节/第一章.md"}',
                    outputSummary: "已读取当前章节，发现主角在入城段落之后直接进入冲突，缺少迟疑和动机铺垫。",
                  },
                  {
                    type: "text",
                    text: "建议先补一段主角迟疑，再推进后续冲突，让人物动机更完整。",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    render(<BookAgentPanel width={420} />);

    fireEvent.click(screen.getByRole("button", { name: /剧情代理/ }));

    expect(screen.getByText("时间线")).toBeInTheDocument();
    expect(screen.getByText("已接收任务")).toBeInTheDocument();
    expect(screen.getByText("深度思考")).toBeInTheDocument();
    expect(screen.getByText("调用工具：read_file")).toBeInTheDocument();
    expect(screen.getByText("生成结果")).toBeInTheDocument();
    expect(screen.getByText(/正在分析冲突走向/)).toBeInTheDocument();
    expect(screen.getByText(/已读取当前章节/)).toBeInTheDocument();
    expect(screen.getByText(/建议先补一段主角迟疑/)).toBeInTheDocument();
  });

  it("同一个子代理更新后仍只保留一张卡片", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "running",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "subagent",
                id: "subagent-1",
                name: "剧情代理",
                status: "running",
                summary: "已委托给剧情代理",
                parts: [{ type: "reasoning", summary: "正在思考", detail: "正在分析请求。" }],
              },
            ],
          },
        ],
      },
    });

    const { rerender } = render(<BookAgentPanel width={420} />);
    expect(screen.queryAllByText("剧情代理")).toHaveLength(1);

    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "subagent",
                id: "subagent-1",
                name: "剧情代理",
                status: "completed",
                summary: "剧情代理已完成分析",
                detail: "建议提前铺垫主角动机。",
                parts: [
                  { type: "reasoning", summary: "正在思考", detail: "正在分析请求。" },
                  { type: "text", text: "建议先补一段主角迟疑。" },
                ],
              },
            ],
          },
        ],
      },
    });

    rerender(<BookAgentPanel width={420} />);

    expect(screen.queryAllByText("剧情代理")).toHaveLength(1);
    expect(screen.getByLabelText("运行成功")).toBeInTheDocument();
  });
});

describe("AgentMessageList", () => {
  it("runStatus 为 running 时显示无背景的思考尾巴", () => {
    render(
      <AgentMessageList
        runStatus="running"
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [{ type: "text", text: "正在处理" }],
          },
        ]}
      />,
    );

    expect(screen.getByText("正在思考")).toBeInTheDocument();
    const tail = screen.getByTestId("agent-thinking-tail");
    expect(tail.innerHTML).not.toContain("rounded-[10px]");
    expect(tail.innerHTML).not.toContain("bg-white");
  });

  it("runStatus 不是 running 时不显示思考尾巴", () => {
    render(
      <AgentMessageList
        runStatus="idle"
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "tool-call",
                toolName: "read_file",
                toolCallId: "tool-1",
                status: "failed",
                inputSummary: '{"path":"章节/第一章.md"}',
                outputSummary: "已中断",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });
});
