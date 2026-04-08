import { beforeEach, describe, expect, it } from "vitest";
import { useAgentSettingsStore } from "./agentSettingsStore";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";

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

    // 持久化验证
    const stored = JSON.parse(localStorage.getItem("ainovelstudio-agent-settings") ?? "{}");
    expect(stored.enabledTools.read_file).toBe(false);
    expect(stored.enabledTools.write_file).toBe(true);

    // 再次 toggle 恢复
    useAgentSettingsStore.getState().toggleTool("read_file");
    expect(useAgentSettingsStore.getState().enabledTools.read_file).toBe(true);
  });

  it("reset 恢复默认值", () => {
    useAgentSettingsStore.getState().toggleTool("write_file");
    useAgentSettingsStore.getState().updateConfig({ model: "custom-model" });

    useAgentSettingsStore.getState().reset();

    const state = useAgentSettingsStore.getState();
    expect(state.enabledTools.write_file).toBe(true);
    expect(state.config.model).toBe("");
    expect(localStorage.getItem("ainovelstudio-agent-settings")).toBeNull();
  });
});
