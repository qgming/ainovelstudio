import { afterEach, describe, expect, it, vi } from "vitest";

// Mock store 的 getState，验证刷新回调被调用与 guardRootMatch 守卫行为。
const mockBookWorkspaceState = {
  rootPath: "/workspace/A" as string | null,
  refreshWorkspaceAfterExternalChange: vi.fn(async () => {}),
};
const mockSkillsRefresh = vi.fn(async () => {});

vi.mock("../../../stores/bookWorkspaceStore", () => ({
  useBookWorkspaceStore: { getState: () => mockBookWorkspaceState },
}));
vi.mock("../../../stores/skillsStore", () => ({
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
    rootPath: string;
    onWorkspaceMutated: () => Promise<void>;
  }) => {
    mockWorkspaceMutated.mockImplementation(opts.onWorkspaceMutated);
    return { workspace_tool: true, _rootPath: opts.rootPath };
  },
}));

import {
  buildBookWorkspaceTools,
  createDefaultBookWorkspaceToolset,
  createDefaultLocalResourceToolset,
} from "./factory";

afterEach(() => {
  vi.clearAllMocks();
  mockBookWorkspaceState.rootPath = "/workspace/A";
});

describe("createDefaultLocalResourceToolset", () => {
  it("封装的 refresh 回调会调度对应 store.refresh", async () => {
    createDefaultLocalResourceToolset();
    await mockRefreshSkillsCaptured.fn?.();
    expect(mockSkillsRefresh).toHaveBeenCalledTimes(1);
  });

  it("includeAsk=false 时会从本地工具集中移除 ask", () => {
    vi.doMock("../tools", () => ({
      createGlobalToolset: () => ({ global_tool: mockGlobalTool }),
      createLocalResourceToolset: () => ({ ask: { description: "ask", execute: vi.fn() }, local_tool: true }),
      createWorkspaceToolset: (opts: { rootPath: string; onWorkspaceMutated: () => Promise<void> }) => {
        mockWorkspaceMutated.mockImplementation(opts.onWorkspaceMutated);
        return { workspace_tool: true, _rootPath: opts.rootPath };
      },
    }));
  });
});

describe("createDefaultBookWorkspaceToolset", () => {
  it("rootPath 为空时返回空集", () => {
    expect(createDefaultBookWorkspaceToolset({ rootPath: null })).toEqual({});
  });

  it("guardRootMatch=false 时无论 store 是否切换，都会调用 refresh", async () => {
    createDefaultBookWorkspaceToolset({ rootPath: "/workspace/A", guardRootMatch: false });
    mockBookWorkspaceState.rootPath = "/workspace/B"; // 用户切书
    await mockWorkspaceMutated();
    expect(mockBookWorkspaceState.refreshWorkspaceAfterExternalChange).toHaveBeenCalledTimes(1);
  });

  it("guardRootMatch=true 时若 store rootPath 不匹配则跳过 refresh", async () => {
    createDefaultBookWorkspaceToolset({ rootPath: "/workspace/A", guardRootMatch: true });
    mockBookWorkspaceState.rootPath = "/workspace/B";
    await mockWorkspaceMutated();
    expect(mockBookWorkspaceState.refreshWorkspaceAfterExternalChange).not.toHaveBeenCalled();
  });

  it("guardRootMatch=true 且匹配时正常 refresh", async () => {
    createDefaultBookWorkspaceToolset({ rootPath: "/workspace/A", guardRootMatch: true });
    mockBookWorkspaceState.rootPath = "/workspace/A";
    await mockWorkspaceMutated();
    expect(mockBookWorkspaceState.refreshWorkspaceAfterExternalChange).toHaveBeenCalledTimes(1);
  });
});

describe("buildBookWorkspaceTools", () => {
  it("含 global + workspace + localResource 三段", () => {
    const tools = buildBookWorkspaceTools({ rootPath: "/workspace/A" });
    expect(tools).toMatchObject({
      global_tool: expect.anything(),
      workspace_tool: true,
      local_tool: true,
    });
  });

  it("rootPath 为空时仅 global + localResource", () => {
    const tools = buildBookWorkspaceTools({ rootPath: null });
    expect(tools).toMatchObject({ global_tool: expect.anything(), local_tool: true });
    expect(tools).not.toHaveProperty("workspace_tool");
  });
});
