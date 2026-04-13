import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
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
  readWorkspaceTextFile: vi.fn(),
}));

vi.mock("./agentSettingsStore", async () => {
  const actual = await vi.importActual<typeof import("./agentSettingsStore")>("./agentSettingsStore");
  return {
    ...actual,
    useAgentSettingsStore: actual.useAgentSettingsStore,
    getStoredDefaultAgentMarkdown: vi.fn(() => ""),
  };
});

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
  runAgentTurn: vi.fn(),
}));

import { initializeChatStorage } from "../lib/chat/api";
import { useAgentSettingsStore } from "./agentSettingsStore";
import { useAgentStore } from "./agentStore";

describe("agentStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    useAgentSettingsStore.getState().reset();
    useAgentStore.getState().reset();
    mockInvoke.mockClear();
  });

  it("stopMessage 会取消全部进行中的工具请求并清空列表", async () => {
    useAgentStore.setState({
      abortController: new AbortController(),
      inflightToolRequestIds: ["tool-read-1", "tool-search-2"],
    });

    useAgentStore.getState().stopMessage();
    await Promise.resolve();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "cancel_tool_request", { requestId: "tool-read-1" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "cancel_tool_request", { requestId: "tool-search-2" });
    expect(useAgentStore.getState().inflightToolRequestIds).toEqual([]);
    expect(useAgentStore.getState().abortController?.signal.aborted).toBe(true);
  });

  it("stopMessage 在没有进行中工具时也只会中止当前 run", () => {
    const abortController = new AbortController();
    useAgentStore.setState({
      abortController,
      inflightToolRequestIds: [],
    });

    useAgentStore.getState().stopMessage();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(abortController.signal.aborted).toBe(true);
    expect(useAgentStore.getState().inflightToolRequestIds).toEqual([]);
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
