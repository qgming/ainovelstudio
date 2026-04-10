import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "../lib/agent/promptContext";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";
import { useAgentSettingsStore } from "./agentSettingsStore";

describe("agent settings store", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("支持单独持久化默认 AGENTS", () => {
    const customMarkdown = "# 主代理\n\n- 优先直接给出可执行结果。";

    useAgentSettingsStore.getState().updateDefaultAgentMarkdown(customMarkdown);

    const state = useAgentSettingsStore.getState();
    const stored = JSON.parse(localStorage.getItem("ainovelstudio-agent-settings") ?? "{}");

    expect(state.defaultAgentMarkdown).toBe(customMarkdown);
    expect(stored.defaultAgentMarkdown).toBe(customMarkdown);
  });

  it("resetConfig 只重置模型配置，不影响默认 AGENTS", () => {
    useAgentSettingsStore.getState().updateConfig({ model: "custom-model" });
    useAgentSettingsStore.getState().updateDefaultAgentMarkdown("# 自定义主代理");

    useAgentSettingsStore.getState().resetConfig();

    const state = useAgentSettingsStore.getState();
    expect(state.config.model).toBe("");
    expect(state.defaultAgentMarkdown).toBe("# 自定义主代理");
  });

  it("resetDefaultAgentMarkdown 恢复内置默认内容", () => {
    useAgentSettingsStore.getState().updateDefaultAgentMarkdown("# 临时主代理");

    useAgentSettingsStore.getState().resetDefaultAgentMarkdown();

    expect(useAgentSettingsStore.getState().defaultAgentMarkdown).toBe(DEFAULT_MAIN_AGENT_MARKDOWN);
  });

  it("reset 恢复默认值", () => {
    useAgentSettingsStore.getState().toggleTool("write_file");
    useAgentSettingsStore.getState().updateConfig({ model: "custom-model" });
    useAgentSettingsStore.getState().updateDefaultAgentMarkdown("# 自定义主代理");

    useAgentSettingsStore.getState().reset();

    const state = useAgentSettingsStore.getState();
    expect(state.enabledTools.write_file).toBe(true);
    expect(state.config.model).toBe("");
    expect(state.defaultAgentMarkdown).toBe(DEFAULT_MAIN_AGENT_MARKDOWN);
    expect(localStorage.getItem("ainovelstudio-agent-settings")).toBeNull();
  });
});
