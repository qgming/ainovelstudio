import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, streamControl } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  streamControl: {
    runAgentTurn: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../lib/chat/api", () => ({
  appendChatMessage: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatMessage: vi.fn(),
  deleteChatSession: vi.fn(),
  initializeChatStorage: vi.fn(),
  setChatDraft: vi.fn(),
  switchChatSession: vi.fn(),
  updateChatMessage: vi.fn(),
}));

vi.mock("../lib/bookWorkspace/api", () => ({
  cancelToolRequests: vi.fn(),
  readWorkspaceTextFile: vi.fn(),
}));

vi.mock("../lib/agentConfig/api", () => ({
  initializeDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
  readDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
  writeDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
}));

vi.mock("../lib/agentSettings/api", () => ({
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

vi.mock("./subAgentStore", () => ({
  getEnabledAgents: vi.fn(() => []),
  useSubAgentStore: {
    getState: () => ({ refresh: vi.fn() }),
  },
}));

vi.mock("../lib/agent/manualTurnContext", () => ({
  resolveManualTurnContext: vi.fn(),
}));

vi.mock("../lib/agent/session", () => ({
  runAgentTurn: streamControl.runAgentTurn,
}));

import { appendChatMessage, createChatSession, initializeChatStorage } from "../lib/chat/api";
import { cancelToolRequests } from "../lib/bookWorkspace/api";
import { resolveManualTurnContext, type ManualTurnContextPayload } from "../lib/agent/manualTurnContext";
import { useAgentSettingsStore } from "./agentSettingsStore";
import { useAgentStore } from "./agentStore";

function createEmptyManualContext(): ManualTurnContextPayload {
  return {
    agents: [],
    files: [],
    skills: [],
  };
}

describe("agentStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    streamControl.runAgentTurn.mockReset();
    streamControl.runAgentTurn.mockImplementation(async function* () {
      return;
    });
    vi.mocked(appendChatMessage).mockReset();
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
    streamControl.runAgentTurn.mockImplementation(async function* () {
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
      agentIds: [],
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

  it("持久化 running summary 回写时不会打断当前运行态", async () => {
    let releaseManualContext!: () => void;
    const manualContextPromise: Promise<ManualTurnContextPayload> = new Promise((resolve) => {
      releaseManualContext = () => resolve(createEmptyManualContext());
    });
    vi.mocked(resolveManualTurnContext).mockReturnValue(manualContextPromise);
    vi.mocked(appendChatMessage).mockResolvedValue({
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
      agentIds: [],
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
    streamControl.runAgentTurn.mockImplementation(async function* () {
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
      agentIds: [],
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
        activeSessionMessages: [],
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
    streamControl.runAgentTurn.mockImplementation(async function* () {
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
      activeSessionMessages: [
        {
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
