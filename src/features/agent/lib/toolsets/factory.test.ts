import { afterEach, describe, expect, it, vi } from "vitest";

// Mock store 的 getState，验证刷新回调被调用与 guardRootMatch 守卫行为。
// 守卫比较的是解析 key rootBookId（UUID），不再是展示串 rootPath。
const mockBookWorkspaceState = {
  rootBookId: "book-A" as string | null,
  rootPath: "/workspace/A" as string | null,
  refreshWorkspaceAfterExternalChange: vi.fn(async () => {}),
};
const mockSkillsRefresh = vi.fn(async () => {});

vi.mock("@features/books/stores/useBookWorkspaceStore", () => ({
  useBookWorkspaceStore: { getState: () => mockBookWorkspaceState },
}));
vi.mock("@features/skills/stores/useSkillsStore", () => ({
  useSkillsStore: { getState: () => ({ refresh: mockSkillsRefresh }) },
}));

// Mock tools 工厂，仅校验调用入参与回调。
const mockGlobalTool = { _global: true };
const mockWorkspaceMutated = vi.fn();
const mockRefreshSkillsCaptured: { fn?: () => Promise<void> } = {};

vi.mock("../tools", () => ({
  createGlobalToolset: () => ({ global_tool: mockGlobalTool }),
  createLocalResourceToolset: (opts: {
    refreshSkills?: () => Promise<void>;
  }) => {
    mockRefreshSkillsCaptured.fn = opts.refreshSkills;
    return { local_tool: true };
  },
  createWorkspaceToolset: (opts: {
    bookId: string;
    displayPath: string;
    onWorkspaceMutated: () => Promise<void>;
  }) => {
    mockWorkspaceMutated.mockImplementation(opts.onWorkspaceMutated);
    return { workspace_tool: true, _bookId: opts.bookId, _displayPath: opts.displayPath };
  },
}));

import {
  buildBookWorkspaceTools,
  createDefaultBookWorkspaceToolset,
  createDefaultLocalResourceToolset,
} from "./factory";

afterEach(() => {
  vi.clearAllMocks();
  mockBookWorkspaceState.rootBookId = "book-A";
  mockBookWorkspaceState.rootPath = "/workspace/A";
});

describe("createDefaultLocalResourceToolset", () => {
  it("封装的 refresh 回调会调度对应 store.refresh", async () => {
    createDefaultLocalResourceToolset();
    await mockRefreshSkillsCaptured.fn?.();
    expect(mockSkillsRefresh).toHaveBeenCalledTimes(1);
  });

  it("includeAsk=false 时会从本地工具集中移除 ask_user", () => {
    vi.doMock("../tools", () => ({
      createGlobalToolset: () => ({ global_tool: mockGlobalTool }),
      createLocalResourceToolset: () => ({ ask_user: { description: "ask_user", execute: vi.fn() }, local_tool: true }),
      createWorkspaceToolset: (opts: { bookId: string; displayPath: string; onWorkspaceMutated: () => Promise<void> }) => {
        mockWorkspaceMutated.mockImplementation(opts.onWorkspaceMutated);
        return { workspace_tool: true, _bookId: opts.bookId, _displayPath: opts.displayPath };
      },
    }));
  });
});

describe("createDefaultBookWorkspaceToolset", () => {
  it("bookId 为空时返回空集", () => {
    expect(createDefaultBookWorkspaceToolset({ bookId: null, displayPath: null })).toEqual({});
  });

  it("guardRootMatch=false 时无论 store 是否切换，都会调用 refresh", async () => {
    createDefaultBookWorkspaceToolset({ bookId: "book-A", displayPath: "/workspace/A", guardRootMatch: false });
    mockBookWorkspaceState.rootBookId = "book-B"; // 用户切书
    await mockWorkspaceMutated();
    expect(mockBookWorkspaceState.refreshWorkspaceAfterExternalChange).toHaveBeenCalledTimes(1);
  });

  it("guardRootMatch=true 时若 store rootBookId 不匹配则跳过 refresh", async () => {
    createDefaultBookWorkspaceToolset({ bookId: "book-A", displayPath: "/workspace/A", guardRootMatch: true });
    mockBookWorkspaceState.rootBookId = "book-B";
    await mockWorkspaceMutated();
    expect(mockBookWorkspaceState.refreshWorkspaceAfterExternalChange).not.toHaveBeenCalled();
  });

  it("guardRootMatch=true 且匹配时正常 refresh", async () => {
    createDefaultBookWorkspaceToolset({ bookId: "book-A", displayPath: "/workspace/A", guardRootMatch: true });
    mockBookWorkspaceState.rootBookId = "book-A";
    await mockWorkspaceMutated();
    expect(mockBookWorkspaceState.refreshWorkspaceAfterExternalChange).toHaveBeenCalledTimes(1);
  });
});

describe("buildBookWorkspaceTools", () => {
  it("含 global + workspace + localResource 三段", () => {
    const tools = buildBookWorkspaceTools({ bookId: "book-A", displayPath: "/workspace/A" });
    expect(tools).toMatchObject({
      global_tool: expect.anything(),
      workspace_tool: true,
      local_tool: true,
    });
  });

  it("bookId 为空时仅 global + localResource", () => {
    const tools = buildBookWorkspaceTools({ bookId: null, displayPath: null });
    expect(tools).toMatchObject({ global_tool: expect.anything(), local_tool: true });
    expect(tools).not.toHaveProperty("workspace_tool");
  });
});
