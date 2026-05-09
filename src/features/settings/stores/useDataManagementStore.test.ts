import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@features/settings/data-sync/dataSyncApi", () => ({
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

vi.mock("@features/settings/data-sync/clientState", () => ({
  collectAppClientState: vi.fn(() => ({ sidebarOpen: true })),
}));

vi.mock("@features/skills/api/skillApi", () => ({
  resetBuiltinSkills: vi.fn(),
}));

import { resetBuiltinSkills } from "@features/skills/api/skillApi";
import { useDataManagementStore } from "./useDataManagementStore";

describe("dataManagementStore", () => {
  beforeEach(() => {
    vi.mocked(resetBuiltinSkills).mockReset();
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

  it("reinitializeSkills 失败时会写入错误状态", async () => {
    vi.mocked(resetBuiltinSkills).mockRejectedValue(new Error("技能重写失败"));

    await expect(
      useDataManagementStore.getState().reinitializeSkills(),
    ).rejects.toThrow("技能重写失败");

    expect(useDataManagementStore.getState().status).toBe("error");
    expect(useDataManagementStore.getState().errorMessage).toBe("技能重写失败");
  });
});
