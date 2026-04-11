import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/skills/api", () => ({
  clearSkillPreferences: vi.fn().mockResolvedValue(undefined),
  createSkill: vi.fn(),
  createSkillReferenceFile: vi.fn(),
  deleteInstalledSkill: vi.fn(),
  importSkillZip: vi.fn(),
  initializeBuiltinSkills: vi.fn(),
  pickSkillArchive: vi.fn(),
  readSkillDetail: vi.fn(),
  readSkillPreferences: vi.fn().mockResolvedValue({ enabledById: {} }),
  scanInstalledSkills: vi.fn(),
  writeSkillPreferences: vi.fn().mockResolvedValue({ enabledById: {} }),
}));

import {
  clearSkillPreferences,
  readSkillPreferences,
  scanInstalledSkills,
  writeSkillPreferences,
} from "../lib/skills/api";
import { getEnabledSkills, getResolvedSkills, useSkillsStore } from "./skillsStore";

describe("skills store", () => {
  beforeEach(async () => {
    vi.mocked(clearSkillPreferences).mockClear();
    vi.mocked(readSkillPreferences).mockResolvedValue({ enabledById: {} });
    vi.mocked(writeSkillPreferences).mockClear();
    vi.mocked(writeSkillPreferences).mockResolvedValue({ enabledById: {} });
    vi.mocked(scanInstalledSkills).mockReset();
    useSkillsStore.setState({
      errorMessage: null,
      lastScannedAt: null,
      manifests: [
        {
          body: "技能正文",
          defaultEnabled: true,
          description: "测试技能",
          discoveredAt: 1,
          id: "builtin-skill",
          isBuiltin: false,
          name: "内置技能",
          rawMarkdown: "---\nname: 内置技能\n---\n技能正文",
          references: [],
          sourceKind: "installed-package",
          suggestedTools: ["read_file"],
          tags: ["builtin"],
          validation: {
            errors: [],
            isValid: true,
            warnings: [],
          },
        },
      ],
      preferences: { enabledById: {} },
      status: "ready",
    });
    await useSkillsStore.getState().reset();
    useSkillsStore.setState((state) => ({ ...state, manifests: [
      {
        body: "技能正文",
        defaultEnabled: true,
        description: "测试技能",
        discoveredAt: 1,
        id: "builtin-skill",
        isBuiltin: false,
        name: "内置技能",
        rawMarkdown: "---\nname: 内置技能\n---\n技能正文",
        references: [],
        sourceKind: "installed-package",
        suggestedTools: ["read_file"],
        tags: ["builtin"],
        validation: {
          errors: [],
          isValid: true,
          warnings: [],
        },
      },
    ], status: "ready" }));
  });

  it("默认启用来自内置默认清单的技能", () => {
    expect(getResolvedSkills(useSkillsStore.getState())[0]?.enabled).toBe(true);
  });

  it("toggleSkill 会把显式偏好写入 SQLite，并覆盖默认启用值", async () => {
    const skillId = getResolvedSkills(useSkillsStore.getState())[0].id;

    await useSkillsStore.getState().toggleSkill(skillId);

    expect(vi.mocked(writeSkillPreferences)).toHaveBeenCalledWith({
      enabledById: { [skillId]: false },
    });
    expect(getResolvedSkills(useSkillsStore.getState())[0]?.enabled).toBe(false);
  });

  it("hydrate 后使用扫描结果和 SQLite 偏好", async () => {
    vi.mocked(scanInstalledSkills).mockResolvedValue([
      {
        body: "技能正文",
        defaultEnabled: false,
        description: "来自磁盘",
        discoveredAt: 1,
        id: "zip-skill",
        isBuiltin: false,
        name: "ZIP 技能",
        rawMarkdown: "---\nname: ZIP 技能\n---\n技能正文",
        references: [],
        sourceKind: "installed-package",
        suggestedTools: ["read_file"],
        tags: ["zip"],
        validation: {
          errors: [],
          isValid: true,
          warnings: [],
        },
      },
    ]);
    vi.mocked(readSkillPreferences).mockResolvedValue({ enabledById: { "zip-skill": true } });

    await useSkillsStore.getState().hydrate();

    const skills = getResolvedSkills(useSkillsStore.getState());
    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe("zip-skill");
    expect(skills[0]?.enabled).toBe(true);
  });

  it("reset 清空偏好后回到默认启用策略", async () => {
    useSkillsStore.setState({ preferences: { enabledById: { "builtin-skill": false } } });

    await useSkillsStore.getState().reset();

    expect(vi.mocked(clearSkillPreferences)).toHaveBeenCalled();
    expect(getEnabledSkills(useSkillsStore.getState()).map((skill) => skill.id)).toContain("builtin-skill");
  });
});
