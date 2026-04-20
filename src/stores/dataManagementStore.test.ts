import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/dataManagement/api", () => ({
  exportAppDataBackup: vi.fn(),
  getDefaultDataSyncSettings: vi.fn(() => ({
    enabled: false,
    password: "",
    remotePath: "ainovelstudio",
    serverUrl: "",
    username: "",
  })),
  importAppDataBackup: vi.fn(),
  readDataSyncSettings: vi.fn(),
  syncAppDataViaWebdav: vi.fn(),
  writeDataSyncSettings: vi.fn(),
}));

vi.mock("../lib/dataManagement/clientState", () => ({
  collectAppClientState: vi.fn(() => ({ sidebarOpen: true })),
}));

vi.mock("../lib/agents/api", () => ({
  resetBuiltinAgents: vi.fn(),
}));

vi.mock("../lib/skills/api", () => ({
  resetBuiltinSkills: vi.fn(),
}));

vi.mock("../lib/workflow/api", () => ({
  resetBuiltinWorkflows: vi.fn(),
}));

import { resetBuiltinAgents } from "../lib/agents/api";
import { resetBuiltinSkills } from "../lib/skills/api";
import { resetBuiltinWorkflows } from "../lib/workflow/api";
import { useDataManagementStore } from "./dataManagementStore";

describe("dataManagementStore", () => {
  beforeEach(() => {
    vi.mocked(resetBuiltinAgents).mockReset();
    vi.mocked(resetBuiltinSkills).mockReset();
    vi.mocked(resetBuiltinWorkflows).mockReset();
    useDataManagementStore.setState({
      config: {
        enabled: false,
        password: "",
        remotePath: "ainovelstudio",
        serverUrl: "",
        username: "",
      },
      errorMessage: null,
      status: "ready",
    });
  });

  it("reinitializeSkills 会调用技能重置命令并清空错误", async () => {
    vi.mocked(resetBuiltinSkills).mockResolvedValue({
      initializedSkillIds: ["builtin-skill"],
      skippedSkillIds: [],
    });
    useDataManagementStore.setState({ errorMessage: "旧错误" });

    const result = await useDataManagementStore.getState().reinitializeSkills();

    expect(vi.mocked(resetBuiltinSkills)).toHaveBeenCalledTimes(1);
    expect(result.initializedSkillIds).toEqual(["builtin-skill"]);
    expect(useDataManagementStore.getState().errorMessage).toBeNull();
  });

  it("reinitializeAgents 会调用代理重置命令并返回初始化结果", async () => {
    vi.mocked(resetBuiltinAgents).mockResolvedValue({
      initializedAgentIds: ["builtin-agent"],
      skippedAgentIds: [],
    });

    const result = await useDataManagementStore.getState().reinitializeAgents();

    expect(vi.mocked(resetBuiltinAgents)).toHaveBeenCalledTimes(1);
    expect(result.initializedAgentIds).toEqual(["builtin-agent"]);
  });

  it("reinitializeWorkflows 失败时会写入错误状态", async () => {
    vi.mocked(resetBuiltinWorkflows).mockRejectedValue(new Error("工作流重写失败"));

    await expect(
      useDataManagementStore.getState().reinitializeWorkflows(),
    ).rejects.toThrow("工作流重写失败");

    expect(useDataManagementStore.getState().status).toBe("error");
    expect(useDataManagementStore.getState().errorMessage).toBe("工作流重写失败");
  });
});
