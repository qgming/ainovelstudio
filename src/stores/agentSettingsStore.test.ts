import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { useAgentSettingsStore } from "./agentSettingsStore";

function mockCommand(command: string, value: unknown) {
  mockInvoke.mockImplementation((receivedCommand: string) => {
    if (receivedCommand === command) {
      return Promise.resolve(value);
    }

    if (receivedCommand === "clear_agent_settings") {
      return Promise.resolve();
    }

    throw new Error(`unexpected command: ${receivedCommand}`);
  });
}

describe("agent settings store", () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    useAgentSettingsStore.getState().reset();
  });

  it("默认所有内置工具为启用状态", () => {
    const { enabledTools } = useAgentSettingsStore.getState();

    for (const tool of BUILTIN_TOOLS) {
      expect(enabledTools[tool.id]).toBe(true);
    }
  });

  it("updateConfig 会写入 SQLite 持久化", async () => {
    mockCommand("write_agent_settings", {
      config: {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "gpt-4o-mini",
        temperature: 0.7,
      },
      enabledTools: {},
    });

    useAgentSettingsStore.getState().updateConfig({
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      temperature: 0.7,
      maxOutputTokens: 4096,
    });
    await Promise.resolve();

    expect(mockInvoke).toHaveBeenCalledWith("write_agent_settings", {
      settings: expect.objectContaining({
        config: expect.objectContaining({
          baseURL: "https://example.com/v1",
          model: "gpt-4o-mini",
          temperature: 0.7,
          maxOutputTokens: 4096,
        }),
      }),
    });
  });

  it("toggleTool 可以切换单个工具并写入 SQLite", async () => {
    mockCommand("write_agent_settings", {
      config: {
        apiKey: "",
        baseURL: "https://api.openai.com/v1",
        maxOutputTokens: 4096,
        model: "",
        temperature: 0.7,
      },
      enabledTools: { read_file: false },
    });

    useAgentSettingsStore.getState().toggleTool("read_file");
    await Promise.resolve();

    expect(useAgentSettingsStore.getState().enabledTools.read_file).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("write_agent_settings", {
      settings: expect.objectContaining({
        enabledTools: expect.objectContaining({
          read_file: false,
          write_file: true,
        }),
      }),
    });
  });

  it("initialize 从 SQLite 读取已有设置，并忽略旧 localStorage", async () => {
    localStorage.setItem(
      "ainovelstudio-agent-settings",
      JSON.stringify({
        config: { model: "legacy-model" },
        enabledTools: { write_file: false },
      }),
    );

    mockInvoke.mockImplementation((command: string) => {
      if (command === "initialize_default_agent_config") {
        return Promise.resolve({
          initializedFromBuiltin: true,
          markdown: "# 文件主代理\n\n- 从本地目录加载。",
          path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
        });
      }

      if (command === "read_agent_settings") {
        return Promise.resolve({
          config: {
            apiKey: "sqlite-key",
            baseURL: "https://example.com/v1",
            maxOutputTokens: 8192,
            model: "sqlite-model",
            temperature: 0.3,
          },
          enabledTools: { read_file: false },
        });
      }

      if (command === "clear_agent_settings") {
        return Promise.resolve();
      }

      throw new Error(`unexpected command: ${command}`);
    });

    await useAgentSettingsStore.getState().initialize();

    const state = useAgentSettingsStore.getState();
    expect(state.config.model).toBe("sqlite-model");
    expect(state.enabledTools.read_file).toBe(false);
    expect(state.enabledTools.write_file).toBe(true);
    expect(localStorage.getItem("ainovelstudio-agent-settings")).not.toBeNull();
    expect(mockInvoke).not.toHaveBeenCalledWith("write_agent_settings", expect.anything());
  });

  it("initialize 会把旧 localStorage 迁移到 SQLite 并清理旧 key", async () => {
    localStorage.setItem(
      "ainovelstudio-agent-settings",
      JSON.stringify({
        config: {
          apiKey: "legacy-key",
          baseURL: "https://legacy.example/v1",
          model: "legacy-model",
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
        enabledTools: {
          rename_path: false,
        },
      }),
    );

    mockInvoke.mockImplementation((command: string, payload?: unknown) => {
      if (command === "initialize_default_agent_config") {
        return Promise.resolve({
          initializedFromBuiltin: true,
          markdown: "# 文件主代理",
          path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
        });
      }

      if (command === "read_agent_settings") {
        return Promise.resolve(null);
      }

      if (command === "write_agent_settings") {
        return Promise.resolve((payload as { settings: unknown }).settings);
      }

      if (command === "clear_agent_settings") {
        return Promise.resolve();
      }

      throw new Error(`unexpected command: ${command}`);
    });

    await useAgentSettingsStore.getState().initialize();

    const state = useAgentSettingsStore.getState();
    expect(state.config.model).toBe("legacy-model");
    expect(state.enabledTools.rename).toBe(false);
    expect(localStorage.getItem("ainovelstudio-agent-settings")).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("write_agent_settings", {
      settings: expect.objectContaining({
        config: expect.objectContaining({
          apiKey: "legacy-key",
          model: "legacy-model",
        }),
        enabledTools: expect.objectContaining({
          rename: false,
        }),
      }),
    });
  });

  it("并发 initialize 会等待同一轮加载完成", async () => {
    const deferred: { resolve: ((value: null) => void) | null } = { resolve: null };

    mockInvoke.mockImplementation((command: string) => {
      if (command === "initialize_default_agent_config") {
        return Promise.resolve({
          initializedFromBuiltin: true,
          markdown: "# 文件主代理",
          path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
        });
      }

      if (command === "read_agent_settings") {
        return new Promise<null>((resolve) => {
          deferred.resolve = resolve;
        });
      }

      if (command === "clear_agent_settings") {
        return Promise.resolve();
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const first = useAgentSettingsStore.getState().initialize();
    const second = useAgentSettingsStore.getState().initialize();

    expect(mockInvoke).toHaveBeenCalledWith("read_agent_settings");
    expect(mockInvoke.mock.calls.filter(([command]) => command === "read_agent_settings")).toHaveLength(1);

    if (deferred.resolve) {
      deferred.resolve(null);
    }
    await Promise.all([first, second]);

    expect(useAgentSettingsStore.getState().status).toBe("ready");
  });

  it("refreshDefaultAgentMarkdown 读取本地目录文件", async () => {
    mockCommand("read_default_agent_config", {
      initializedFromBuiltin: true,
      markdown: "# 刷新后的主代理\n\n- 来自本地目录文件。",
      path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
    });

    await useAgentSettingsStore.getState().refreshDefaultAgentMarkdown();

    expect(mockInvoke).toHaveBeenCalledWith("read_default_agent_config");
    expect(useAgentSettingsStore.getState().defaultAgentMarkdown).toContain("刷新后的主代理");
  });

  it("updateDefaultAgentMarkdown 写回配置文件", async () => {
    mockCommand("write_default_agent_config", {
      initializedFromBuiltin: true,
      markdown: "# 自定义主代理\n\n- 直接写回本地目录文件。",
      path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
    });

    await useAgentSettingsStore
      .getState()
      .updateDefaultAgentMarkdown("# 自定义主代理\n\n- 直接写回本地目录文件。");

    expect(mockInvoke).toHaveBeenCalledWith("write_default_agent_config", {
      content: "# 自定义主代理\n\n- 直接写回本地目录文件。",
    });
    expect(useAgentSettingsStore.getState().defaultAgentMarkdown).toBe(
      "# 自定义主代理\n\n- 直接写回本地目录文件。",
    );
  });

  it("resetConfig 只重置模型配置，不影响当前 AGENTS 内容", () => {
    mockCommand("write_agent_settings", {
      config: {
        apiKey: "",
        baseURL: "https://api.openai.com/v1",
        maxOutputTokens: 4096,
        model: "",
        temperature: 0.7,
      },
      enabledTools: {},
    });

    useAgentSettingsStore.setState({ defaultAgentMarkdown: "# 文件主代理" });
    useAgentSettingsStore.getState().updateConfig({ model: "custom-model" });

    useAgentSettingsStore.getState().resetConfig();

    const state = useAgentSettingsStore.getState();
    expect(state.config.model).toBe("");
    expect(state.defaultAgentMarkdown).toBe("# 文件主代理");
  });

  it("reset 恢复默认值并清理旧 localStorage", () => {
    localStorage.setItem("ainovelstudio-agent-settings", JSON.stringify({ config: { model: "legacy-model" } }));
    mockCommand("clear_agent_settings", undefined);

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
