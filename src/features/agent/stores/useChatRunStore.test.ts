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

vi.mock("@features/agent/chat/api", () => ({
  appendChatEntry: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatEntry: vi.fn(),
  deleteChatSession: vi.fn(),
  initializeChatStorage: vi.fn(),
  setChatDraft: vi.fn(),
  switchChatSession: vi.fn(),
  updateChatEntry: vi.fn(),
}));

vi.mock("@features/books/api/bookWorkspaceApi", () => ({
  cancelToolRequests: vi.fn(),
  readWorkspaceTextFile: vi.fn(),
  readWorkspaceTree: vi.fn(),
}));

vi.mock("@features/settings/api/defaultAgentConfigApi", () => ({
  initializeDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
  readDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
  writeDefaultAgentConfig: vi.fn(async () => ({ markdown: "", path: null })),
}));

vi.mock("@features/settings/api/agentSettingsApi", () => ({
  clearAgentSettings: vi.fn(async () => undefined),
  readAgentSettings: vi.fn(async () => null),
  writeAgentSettings: vi.fn(async () => undefined),
}));

vi.mock("@features/books/stores/useBookWorkspaceStore", () => ({
  useBookWorkspaceStore: {
    getState: () => ({
      activeFilePath: null,
      draftContent: "",
      refreshWorkspaceAfterExternalChange: vi.fn(),
      rootBookId: null,
      rootPath: null,
    }),
  },
}));

vi.mock("@features/skills/stores/useSkillsStore", () => ({
  getEnabledSkills: vi.fn(() => []),
  useSkillsStore: {
    getState: () => ({ refresh: vi.fn() }),
  },
}));

vi.mock("@features/agent/lib/prompt-context/manualTurnContext", () => ({
  resolveManualTurnContext: vi.fn(),
}));

vi.mock("@features/agent/lib/session", () => ({
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

import { appendChatEntry, createChatSession, initializeChatStorage } from "@features/agent/chat/api";
import { cancelToolRequests } from "@features/books/api/bookWorkspaceApi";
import { createWritingAgentSession } from "@features/agent/lib/session";
import { resolveManualTurnContext, type ManualTurnContextPayload } from "@features/agent/lib/prompt-context/manualTurnContext";
import { readAgentSettings } from "@features/settings/api/agentSettingsApi";
import { useAgentSettingsStore } from "@features/settings/stores/useAgentSettingsStore";
import { useChatRunStore as useAgentStore } from "./useChatRunStore";

function createEmptyManualContext(): ManualTurnContextPayload {
  return {
    files: [],
    skills: [],
  };
}

describe("useChatRunStore", () => {
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

  it("手动压缩上下文前会先加载已保存的模型配置", async () => {
    useAgentSettingsStore.getState().reset();
    vi.mocked(readAgentSettings).mockResolvedValueOnce({
      config: {
        apiKey: "saved-key",
        baseURL: "https://saved.example/v1",
        model: "saved-model",
      },
      enabledTools: {},
      modelConfigPresets: [],
      providerPresets: [],
    });
    useAgentStore.setState({
      activeSessionId: "session-1",
      entriesBySession: { "session-1": [] },
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

    await useAgentStore.getState().compactSession();

    expect(readAgentSettings).toHaveBeenCalled();
    expect(useAgentSettingsStore.getState().config).toMatchObject({
      apiKey: "saved-key",
      baseURL: "https://saved.example/v1",
      model: "saved-model",
    });
    expect(useAgentStore.getState().errorMessage).toBeNull();
    expect(useAgentStore.getState().isCompacting).toBe(false);
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

  it("会批量合并密集 text-delta，避免每个 token 都触发 UI 更新", async () => {
    streamControl.runPrompt.mockImplementation(async function* () {
      for (let index = 0; index < 100; index += 1) {
        yield { type: "text-delta", delta: "字" };
      }
    });
    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "生成长文本",
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

    let assistantTextUpdates = 0;
    const unsubscribe = useAgentStore.subscribe((state) => {
      const latest = state.run.messages.at(-1);
      const text = latest?.parts.find((part) => part.type === "text");
      if (text?.type === "text") assistantTextUpdates += 1;
    });

    await useAgentStore.getState().sendMessage();
    unsubscribe();

    const latest = useAgentStore.getState().run.messages.at(-1);
    const text = latest?.parts.find((part) => part.type === "text");
    expect(text).toEqual({ type: "text", text: "字".repeat(100) });
    expect(assistantTextUpdates).toBeLessThan(10);
  });

  it("coachMessage 会发送轻量继续提示词", async () => {
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
    expect(prompt).toBe("请继续执行刚才未完成的任务，从当前断点往下做即可。不要额外改变任务目标或创作要求。");
    expect(prompt).not.toContain("剧情");
    expect(prompt).not.toContain("人设");
    expect(prompt).not.toContain("风格");
    expect(prompt).not.toContain("节奏");
    expect(prompt).not.toContain("冲突");
    expect(prompt).not.toContain("爽点");
  });

  it("YOLO 模式以 autopilot 模式与目标启动，单次 prompt 驱动 harness 内循环至完成", async () => {
    // CP-F：autopilot 续轮已收进 harness 内循环（runWritingAgentHarness 的 decideContinuation），
    // 不再由 React store 外循环重复调用 prompt。本测试 mock 在 session.prompt 边界之上，
    // 故 runPrompt 只被调用 1 次；多轮续轮判定由 lib/modes/modes.test.ts 覆盖。
    // 这里只验证「以正确模式/目标启动」+「单次流末尾的 complete 裁定收口到 completed」。
    streamControl.runPrompt.mockImplementation(async function* () {
      yield { type: "text-delta", delta: "推进并完成第一章审校。" };
      yield {
        type: "tool-call",
        toolName: "yolo_control",
        toolCallId: "yolo-control-1",
        status: "running",
        inputSummary: '{"action":"complete"}',
      };
      yield {
        type: "tool-result",
        toolName: "yolo_control",
        toolCallId: "yolo-control-1",
        status: "completed",
        outputSummary: '{"kind":"yolo-control","action":"complete"}',
        output: {
          accepted: true,
          action: "complete",
          createdAt: "2026-05-10T00:00:00.000Z",
          evidence: ["文件已写回"],
          goal: "完成第一章审校并写回文件",
          kind: "yolo-control",
          missing: [],
          reason: "完成",
          remaining: [],
          stateUpdated: true,
          verification: ["已读取验证"],
        },
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

    expect(streamControl.runPrompt).toHaveBeenCalledTimes(1);
    expect(streamControl.runPrompt.mock.calls[0]?.[0]?.mode).toBe("autopilot");
    expect(streamControl.runPrompt.mock.calls[0]?.[0]?.modeContext).toMatchObject({
      goal: "完成第一章审校并写回文件",
      iteration: 1,
    });
    expect(useAgentStore.getState().autopilotGoalsBySession["session-1"]).toBe("完成第一章审校并写回文件");
    expect(useAgentStore.getState().run.status).toBe("completed");
  });

  it("一次含工具调用的 run 只产生一条 assistant 消息，且工具卡片收口为 completed（修复拆两条/卡 running/主键冲突）", async () => {
    // 回归三连 bug 的盲区：真实 pi 事件流里，一次普通工具调用会产生 turn1(assistant+tool-call)
    // → toolResult message_start → turn_end → turn2(assistant 回复) → turn_end。旧逻辑把
    // 第 2 个 assistant message_start（及被误判的 toolResult message_start）当成新一轮，拆出
    // 第二条气泡并用已存在 id 二次 appendChatEntry（主键冲突）。本测试在 session 边界同时驱动
    // subscribe（同步 emit 真实事件）与 prompt（产 part），断言：① 只新增一条 assistant 消息；
    // ② 该消息内 tool-call 收口为 completed；③ appendChatEntry 不会用重复 id 调用。
    let listener: ((event: { type: string; message?: { role: string; id: string } }) => void) | null = null;
    // adapter 每个 turn 用不同的临时 messageId（assistant-{turnN}）。
    const turn1Id = "assistant-turn-1";
    const turn2Id = "assistant-turn-2";

    vi.mocked(createWritingAgentSession).mockImplementationOnce((options) => ({
      abort: (reason?: string) => options.abortController?.abort(reason),
      compact: vi.fn(),
      followUp: vi.fn(),
      // prompt 串行：先同步发 turn1 的事件 + 产 tool-call/tool-result part，
      // 再发 toolResult/turn2 的 message_start（曾触发拆消息），最后产工具后文本。
      prompt: async function* () {
        listener?.({ type: "turn_start" });
        listener?.({ type: "message_start", message: { role: "assistant", id: turn1Id } });
        yield {
          type: "tool-call",
          toolName: "workspace_write",
          toolCallId: "call-write-1",
          status: "running",
          inputSummary: '{"path":"a.md"}',
          messageId: turn1Id,
        };
        yield {
          type: "tool-result",
          toolName: "workspace_write",
          toolCallId: "call-write-1",
          status: "completed",
          outputSummary: '{"ok":true}',
          output: { ok: true },
          messageId: turn1Id,
        };
        // 工具结果消息（role=toolResult）的 message_start —— 旧逻辑会误判为新助手轮。
        listener?.({ type: "message_start", message: { role: "toolResult", id: turn1Id } });
        listener?.({ type: "turn_end" });
        // turn2：工具后的助手回复轮，又一个 assistant message_start —— 旧逻辑在此拆第二条气泡。
        listener?.({ type: "turn_start" });
        listener?.({ type: "message_start", message: { role: "assistant", id: turn2Id } });
        yield { type: "text-delta", delta: "已写入文件。", messageId: turn2Id };
        listener?.({ type: "turn_end" });
      },
      steer: vi.fn(),
      subscribe: vi.fn((cb: typeof listener) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
      waitForIdle: vi.fn(),
    }) as unknown as ReturnType<typeof createWritingAgentSession>);

    useAgentStore.setState({
      activeSessionId: "session-1",
      input: "写入文件",
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

    const messages = useAgentStore.getState().run.messages;
    // user + 唯一一条 assistant（不再因工具调用拆成两条）。
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    const assistant = messages[1];
    expect(assistant?.role).toBe("assistant");

    // tool-call 收口为 completed（不再永远停在 running），且无"未匹配"validationError。
    const toolCall = assistant?.parts.find((part) => part.type === "tool-call");
    expect(toolCall).toMatchObject({ toolName: "workspace_write", status: "completed" });
    expect(assistant?.parts.some((part) => part.type === "tool-result" && part.validationError)).toBe(false);
    // 工具后的文本与工具卡片在同一条消息内。
    expect(assistant?.parts.some((part) => part.type === "text" && part.text === "已写入文件。")).toBe(true);

    // appendChatEntry 不应被用重复的 entry id 调用（旧逻辑会用 turn1Id 二次 append → 主键冲突）。
    const appendedIds = vi.mocked(appendChatEntry).mock.calls.map((call) => call[2]?.id);
    const duplicates = appendedIds.filter((id, index) => id !== undefined && appendedIds.indexOf(id) !== index);
    expect(duplicates).toEqual([]);

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

  it("非显式用户停止导致的 abort 会按失败处理而不是上下文取消", async () => {
    streamControl.runPrompt.mockImplementation(async function* (options: { abortController: AbortController }) {
      options.abortController.abort(new Error("provider stream closed unexpectedly"));
      throw new Error("provider stream closed unexpectedly");
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
        text: expect.stringContaining("provider stream closed unexpectedly"),
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
    ]);
  });
});
