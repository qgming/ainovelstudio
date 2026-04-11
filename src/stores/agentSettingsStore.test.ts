import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { useAgentSettingsStore } from "./agentSettingsStore";

describe("agent settings store", () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    useAgentSettingsStore.getState().reset();
  });

  it("持久化 provider 配置", () => {
    useAgentSettingsStore.getState().updateConfig({
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      temperature: 0.7,
      maxOutputTokens: 4096,
    });

    const stored = JSON.parse(localStorage.getItem("ainovelstudio-agent-settings") ?? "{}");
    expect(stored.config).toMatchObject({
      baseURL: "https://example.com/v1",
      model: "gpt-4o-mini",
      temperature: 0.7,
      maxOutputTokens: 4096,
    });
  });

  it("默认所有内置工具为启用状态", () => {
    const { enabledTools } = useAgentSettingsStore.getState();

    for (const tool of BUILTIN_TOOLS) {
      expect(enabledTools[tool.id]).toBe(true);
    }
  });

  it("toggleTool 可以切换单个工具的启用状态", () => {
    useAgentSettingsStore.getState().toggleTool("read_file");

    expect(useAgentSettingsStore.getState().enabledTools.read_file).toBe(false);

    const stored = JSON.parse(localStorage.getItem("ainovelstudio-agent-settings") ?? "{}");
    expect(stored.enabledTools.read_file).toBe(false);
    expect(stored.enabledTools.write_file).toBe(true);
  });

  it("initialize 从配置目录加载默认 AGENTS", async () => {
    mockInvoke.mockResolvedValue({
      initializedFromBuiltin: true,
      markdown: "# 文件主代理\n\n- 从配置目录加载。",
      path: "C:/Users/test/AppData/Roaming/ainovelstudio/config/AGENTS.md",
    });

    await useAgentSettingsStore.getState().initialize();

    const state = useAgentSettingsStore.getState();
    expect(mockInvoke).toHaveBeenCalledWith("initialize_default_agent_config");
    expect(state.defaultAgentMarkdown).toBe("# 文件主代理\n\n- 从配置目录加载。");
    expect(state.configFilePath).toContain("config/AGENTS.md");
    expect(state.status).toBe("ready");
  });

  it("refreshDefaultAgentMarkdown 读取用户配置目录文件", async () => {
    mockInvoke.mockResolvedValue({
      initializedFromBuiltin: false,
      markdown: "# 刷新后的主代理\n\n- 来自用户配置文件。",
      path: "C:/Users/test/AppData/Roaming/ainovelstudio/config/AGENTS.md",
    });

    await useAgentSettingsStore.getState().refreshDefaultAgentMarkdown();

    expect(mockInvoke).toHaveBeenCalledWith("read_default_agent_config");
    expect(useAgentSettingsStore.getState().defaultAgentMarkdown).toContain("刷新后的主代理");
  });

  it("updateDefaultAgentMarkdown 写回配置文件", async () => {
    mockInvoke.mockResolvedValue({
      initializedFromBuiltin: false,
      markdown: "# 自定义主代理\n\n- 只使用文件保存。",
      path: "C:/Users/test/AppData/Roaming/ainovelstudio/config/AGENTS.md",
    });

    await useAgentSettingsStore.getState().updateDefaultAgentMarkdown("# 自定义主代理\n\n- 只使用文件保存。");

    expect(mockInvoke).toHaveBeenCalledWith("write_default_agent_config", {
      content: "# 自定义主代理\n\n- 只使用文件保存。",
    });
    expect(useAgentSettingsStore.getState().defaultAgentMarkdown).toBe("# 自定义主代理\n\n- 只使用文件保存。");
  });

  it("resetConfig 只重置模型配置，不影响当前 AGENTS 内容", () => {
    useAgentSettingsStore.setState({ defaultAgentMarkdown: "# 文件主代理" });
    useAgentSettingsStore.getState().updateConfig({ model: "custom-model" });

    useAgentSettingsStore.getState().resetConfig();

    const state = useAgentSettingsStore.getState();
    expect(state.config.model).toBe("");
    expect(state.defaultAgentMarkdown).toBe("# 文件主代理");
  });

  it("reset 恢复本地默认值", () => {
    useAgentSettingsStore.getState().toggleTool("write_file");
    useAgentSettingsStore.getState().updateConfig({ model: "custom-model" });
    useAgentSettingsStore.setState({ defaultAgentMarkdown: "# 文件主代理", status: "ready" });

    useAgentSettingsStore.getState().reset();

    const state = useAgentSettingsStore.getState();
    expect(state.enabledTools.write_file).toBe(true);
    expect(state.config.model).toBe("");
    expect(state.defaultAgentMarkdown).toBe("");
    expect(localStorage.getItem("ainovelstudio-agent-settings")).toBeNull();
  });
});
