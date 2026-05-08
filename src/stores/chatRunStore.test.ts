import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, streamControl } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  streamControl: {
    runPrompt: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../lib/chat/api", () => ({
  appendChatEntry: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatEntry: vi.fn(),
  deleteChatSession: vi.fn(),
  initializeChatStorage: vi.fn(),
  setChatDraft: vi.fn(),
  switchChatSession: vi.fn(),
  updateChatEntry: vi.fn(),
}));

vi.mock("../lib/bookWorkspace/api", () => ({
  cancelToolRequests: vi.fn(),
  readWorkspaceTextFile: vi.fn(),
  readWorkspaceTree: vi.fn(),
}));

vi.mock("../lib/agentConfig", () => ({
  initializeDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
  readDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
  writeDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
}));

vi.mock("../lib/agentSettings", () => ({
  clearAgentSettings: vi.fn(async () => undefined),
  readAgentSettings: vi.fn(async () => null),
  writeAgentSettings: vi.fn(async () => undefined),
}));

vi.mock("./bookWorkspaceStore", () => ({
  useBookWorkspaceStore: {
    getState: () => ({
      activeFilePath: null,
      draftContent: "",
      refreshWorkspaceAfterExternalChange: vi.fn(),
      rootPath: null,
    }),
  },
}));

vi.mock("./skillsStore", () => ({
  getEnabledSkills: vi.fn(() => []),
  useSkillsStore: {
    getState: () => ({ refresh: vi.fn() }),
  },
}));

vi.mock("../lib/agent/manualTurnContext", () => ({
  resolveManualTurnContext: vi.fn(),
}));

vi.mock("../lib/agent/session", () => ({
  createWritingAgentSession: vi.fn((options) => ({
    abort: (reason?: string) => options.abortController?.abort(reason),
    compact: vi.fn(),
    followUp: vi.fn(),
    prompt: (prompt: string) => streamControl.runPrompt({ ...options, prompt }),
    steer: vi.fn(async (prompt: string) => streamControl.runPrompt({ ...options, prompt })),
    subscribe: vi.fn(() => () => undefined),
    waitForIdle: vi.fn(),
  })),
}));

import { appendChatEntry, createChatSession, initializeChatStorage } from "../lib/chat/api";
import { cancelToolRequests } from "../lib/bookWorkspace/api";
import { resolveManualTurnContext, type ManualTurnContextPayload } from "../lib/agent/manualTurnContext";
import { useAgentSettingsStore } from "./agentSettingsStore";
import { useChatRunStore as useAgentStore } from "./chatRunStore";

function createEmptyManualContext(): ManualTurnContextPayload {
  return {
    files: [],
    skills: [],
  };
}

describe("chatRunStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    streamControl.runPrompt.mockReset();
    streamControl.runPrompt.mockImplementation(async function* () {
      return;
    });
    vi.mocked(appendChatEntry).mockReset();
    vi.mocked(resolveManualTurnContext).mockReset();
    vi.mocked(resolveManualTurnContext).mockResolvedValue(createEmptyManualContext());
    vi.mocked(cancelToolRequests).mockReset();
    vi.mocked(cancelToolRequests).mockResolvedValue(undefined);
    useAgentSettingsStore.getState().reset();
    useAgentSettingsStore.setState({
      config: {
        apiKey: "test-key",
        baseURL: "https://example.test",
        model: "test-model",
      },
      defaultAgentMarkdown: "# Test agent",
      enabledTools: {},
      errorMessage: null,
      status: "ready",
      configFilePath: null,
    });
    useAgentStore.getState().reset();
    mockInvoke.mockClear();
  });

  it("stopMessage 会批量取消全部进行中的工具请求并清空列表", async () => {
    useAgentStore.setState({
      abortController: new AbortController(),
      inflightToolRequestIds: ["tool-read-1", "tool-search-2"],
    });

    useAgentStore.getState().stopMessage();
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelToolRequests).toHaveBeenCalledWith(["tool-read-1", "tool-search-2"]);
    expect(useAgentStore.getState().inflightToolRequestIds).toEqual([]);
    expect(useAgentStore.getState().abortController).toBeNull();
  });

  it("stopMessage 在没有进行中工具时也只会中止当前 run", async () => {
    const abortController = new AbortController();
    useAgentStore.setState({
      abortController,
      inflightToolRequestIds: [],
    });

    useAgentStore.getState().stopMessage();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(cancelToolRequests).toHaveBeenCalledWith([]);
    expect(abortController.signal.aborted).toBe(true);
    expect(useAgentStore.getState().inflightToolRequestIds).toEqual([]);
    expect(useAgentStore.getState().abortController).toBeNull();
  });

  it("sendMessage 会在准备阶段前立即进入运行态", async () => {
    let releaseManualContext!: () => void;
    const manualContextPromise: Promise<ManualTurnContextPayload> = new Promise((resolve) => {
      releaseManualContext = () => resolve(createEmptyManualContext());
    });
    vi.mocked(resolveManualTurnContext).mockReturnValue(manualContextPromise);
    streamControl.runPrompt.mockImplementation(async function* () {
      yield { type: "text-delta", delta: "已开始响应" };
    });

    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "继续写",
      isHydrated: true,
      messagesBySession: { "session-1": [] },
      run: {
        id: "session-1",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      status: "ready",
    });

    const sendPromise = useAgentStore.getState().sendMessage({
      filePaths: [],
      skillIds: [],
    });
    await Promise.resolve();

    const runningState = useAgentStore.getState();
    expect(runningState.run.status).toBe("running");
    expect(runningState.run.messages).toHaveLength(2);
    expect(runningState.run.messages[0]?.role).toBe("user");
    expect(runningState.run.messages[1]?.parts).toEqual([{ type: "placeholder", text: "正在思考" }]);
    expect(runningState.activeRunRequestId).not.toBeNull();
    expect(runningState.input).toBe("");

    releaseManualContext();
    await sendPromise;

    expect(useAgentStore.getState().run.status).toBe("completed");
  });

  it("coachMessage 会发送只针对执行状态的鞭策提示词", async () => {
    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "",
      isHydrated: true,
      messagesBySession: { "session-1": [] },
      run: {
        id: "session-1",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      status: "ready",
    });

    await useAgentStore.getState().coachMessage();

    const prompt = streamControl.runPrompt.mock.calls[0]?.[0]?.prompt;
    expect(prompt).toContain("节奏明显慢了");
    expect(prompt).toContain("原来的剧情、人设、风格都保留");
    expect(prompt).toContain("先说清楚卡点");
    expect(prompt).toContain("把冲突和爽点往前推");
  });

  it("目标模式会持续自动检查并执行到目标完成", async () => {
    let callCount = 0;
    streamControl.runPrompt.mockImplementation(async function* () {
      callCount += 1;
      yield {
        type: "text-delta",
        delta: callCount === 9 ? "目标已完成，已经写回目标文件。" : `第 ${callCount} 轮继续推进。`,
      };
    });

    useAgentStore.setState({
      activeModeId: "autopilot",
      activeSessionId: "session-1",
      input: "完成第一章审校并写回文件",
      isHydrated: true,
      messagesBySession: { "session-1": [] },
      run: {
        id: "session-1",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      status: "ready",
    });

    await useAgentStore.getState().sendMessage();

    expect(streamControl.runPrompt).toHaveBeenCalledTimes(9);
    expect(streamControl.runPrompt.mock.calls[0]?.[0]?.mode).toBe("autopilot");
    expect(streamControl.runPrompt.mock.calls[0]?.[0]?.modeContext).toMatchObject({
      goal: "完成第一章审校并写回文件",
      iteration: 1,
    });
    expect(streamControl.runPrompt.mock.calls[1]?.[0]?.prompt).toContain("自动检查");
    expect(streamControl.runPrompt.mock.calls[8]?.[0]?.modeContext).toMatchObject({
      goal: "完成第一章审校并写回文件",
      iteration: 9,
    });
    expect(useAgentStore.getState().autopilotGoalsBySession["session-1"]).toBe("完成第一章审校并写回文件");
    expect(useAgentStore.getState().run.status).toBe("completed");
  });

  it("持久化 running summary 回写时不会打断当前运行态", async () => {
    let releaseManualContext!: () => void;
    const manualContextPromise: Promise<ManualTurnContextPayload> = new Promise((resolve) => {
      releaseManualContext = () => resolve(createEmptyManualContext());
    });
    vi.mocked(resolveManualTurnContext).mockReturnValue(manualContextPromise);
    vi.mocked(appendChatEntry).mockResolvedValue({
      id: "session-1",
      title: "继续写",
      summary: "正在思考",
      status: "running",
      createdAt: "1",
      updatedAt: "2",
      lastMessageAt: "2",
      pinned: false,
      archived: false,
    });

    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "继续写",
      isHydrated: true,
      messagesBySession: { "session-1": [] },
      run: {
        id: "session-1",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      sessions: [
        {
          id: "session-1",
          title: "新对话",
          summary: "",
          status: "idle",
          createdAt: "1",
          updatedAt: "1",
          lastMessageAt: null,
          pinned: false,
          archived: false,
        },
      ],
      status: "ready",
    });

    const sendPromise = useAgentStore.getState().sendMessage({
      filePaths: [],
      skillIds: [],
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const runningState = useAgentStore.getState();
    expect(runningState.run.status).toBe("running");
    expect(runningState.sessions[0]?.status).toBe("running");
    expect(runningState.activeRunRequestId).not.toBeNull();

    releaseManualContext();
    await sendPromise;
  });

  it("stopMessage 会在准备阶段立即清理运行态并移除占位消息", async () => {
    let releaseManualContext!: () => void;
    const manualContextPromise: Promise<ManualTurnContextPayload> = new Promise((resolve) => {
      releaseManualContext = () => resolve(createEmptyManualContext());
    });
    vi.mocked(resolveManualTurnContext).mockReturnValue(manualContextPromise);
    streamControl.runPrompt.mockImplementation(async function* () {
      yield { type: "text-delta", delta: "不会显示" };
    });

    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "继续写",
      isHydrated: true,
      messagesBySession: { "session-1": [] },
      run: {
        id: "session-1",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      status: "ready",
    });

    const sendPromise = useAgentStore.getState().sendMessage({
      filePaths: [],
      skillIds: [],
    });
    await Promise.resolve();

    useAgentStore.getState().stopMessage();
    await Promise.resolve();
    await Promise.resolve();

    const stoppedState = useAgentStore.getState();
    expect(stoppedState.run.status).toBe("idle");
    expect(stoppedState.run.messages).toHaveLength(1);
    expect(stoppedState.run.messages[0]?.role).toBe("user");
    expect(stoppedState.activeRunRequestId).toBeNull();
    expect(stoppedState.abortController).toBeNull();

    releaseManualContext();
    await sendPromise;

    const finalState = useAgentStore.getState();
    expect(finalState.run.status).toBe("idle");
    expect(finalState.run.messages).toHaveLength(1);
  });

  it("首次发送前即使尚未创建会话也会立刻显示正在思考", async () => {
    let releaseCreateSession!: () => void;
    const createSessionPromise = new Promise<Awaited<ReturnType<typeof createChatSession>>>((resolve) => {
      releaseCreateSession = () => resolve({
        activeSessionDraft: "",
        activeSessionId: "session-1",
        activeSessionEntries: [],
        sessions: [
          {
            id: "session-1",
            title: "新对话",
            summary: "",
            status: "idle",
            createdAt: "1",
            updatedAt: "1",
            lastMessageAt: null,
            pinned: false,
            archived: false,
          },
        ],
      });
    });
    vi.mocked(createChatSession).mockReturnValue(createSessionPromise);

    useAgentStore.setState({
      activeSessionId: null,
      input: "第一次发送",
      isHydrated: true,
      messagesBySession: {},
      run: {
        id: "run-default",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      sessions: [],
      status: "ready",
    });

    const sendPromise = useAgentStore.getState().sendMessage();
    await Promise.resolve();

    const runningState = useAgentStore.getState();
    expect(runningState.run.status).toBe("running");
    expect(runningState.run.messages).toHaveLength(2);
    expect(runningState.run.messages[0]?.role).toBe("user");
    expect(runningState.run.messages[1]?.parts).toEqual([{ type: "placeholder", text: "正在思考" }]);
    expect(runningState.input).toBe("");

    releaseCreateSession();
    await sendPromise;

    expect(useAgentStore.getState().run.status).toBe("completed");
    expect(useAgentStore.getState().activeSessionId).toBe("session-1");
  });

  it("sendMessage 在首个响应前报错时会结束运行态并追加错误消息", async () => {
    streamControl.runPrompt.mockImplementation(async function* () {
      throw new Error("provider exploded");
    });

    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "继续写",
      isHydrated: true,
      messagesBySession: { "session-1": [] },
      run: {
        id: "session-1",
        status: "idle",
        title: "新对话",
        messages: [],
      },
      status: "ready",
    });

    await useAgentStore.getState().sendMessage();

    const state = useAgentStore.getState();
    expect(state.run.status).toBe("failed");
    expect(state.activeRunRequestId).toBeNull();
    expect(state.run.messages.at(-1)?.role).toBe("system");
    expect(state.run.messages.at(-1)?.parts).toEqual([
      {
        type: "text",
        text: expect.stringContaining("provider exploded"),
      },
    ]);
  });

  it("initialize 会把恢复出的 running 会话降级为空闲并清理未完成 part", async () => {
    vi.mocked(initializeChatStorage).mockResolvedValue({
      activeSessionDraft: "",
      activeSessionId: "session-1",
      activeSessionEntries: [
        {
          id: "assistant-1",
          seq: 1,
          entryType: "message",
          payload: {
            message: {
              id: "assistant-1",
              role: "assistant",
              author: "主代理",
              parts: [
                { type: "placeholder", text: "正在思考" },
                {
                  type: "tool-call",
                  toolName: "read_file",
                  toolCallId: "tool-1",
                  status: "running",
                  inputSummary: "{\"path\":\"章节/第一章.md\"}",
                },
                {
                  type: "subagent",
                  id: "subagent-1",
                  name: "editor",
                  status: "running",
                  summary: "已派发子任务：editor",
                  parts: [{ type: "placeholder", text: "正在思考" }],
                },
              ],
            },
          },
          createdAt: "1",
        },
      ],
      sessions: [
        {
          id: "session-1",
          title: "当前任务",
          summary: "正在执行",
          status: "running",
          createdAt: "1",
          updatedAt: "2",
          lastMessageAt: "2",
          pinned: false,
          archived: false,
        },
      ],
    });

    await useAgentStore.getState().initialize();

    const state = useAgentStore.getState();
    expect(state.run.status).toBe("idle");
    expect(state.sessions[0]?.status).toBe("idle");
    expect(state.inflightToolRequestIds).toEqual([]);
    expect(state.run.messages).toHaveLength(1);
    expect(state.run.messages[0]?.parts).toEqual([
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "tool-1",
        status: "failed",
        inputSummary: '{"path":"章节/第一章.md"}',
        outputSummary: "已中断",
      },
      {
        type: "subagent",
        id: "subagent-1",
        name: "editor",
        status: "failed",
        summary: "已派发子任务：editor",
        detail: "执行已中断。",
        parts: [],
      },
    ]);
  });
});
