import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/skills/api", () => ({
  deleteInstalledSkill: vi.fn(),
  importSkillZip: vi.fn(),
  initializeBuiltinSkills: vi.fn(),
  pickSkillArchive: vi.fn(),
  readSkillDetail: vi.fn(),
  scanInstalledSkills: vi.fn(),
}));

import { scanInstalledSkills } from "../lib/skills/api";
import { getEnabledSkills, getResolvedSkills, useSkillsStore } from "./skillsStore";

describe("skills store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSkillsStore.getState().reset();
    useSkillsStore.setState({
      manifests: [
        {
          body: "技能正文",
          description: "测试技能",
          discoveredAt: 1,
          id: "builtin-skill",
          isBuiltin: true,
          name: "内置技能",
          rawMarkdown: "---\nname: 内置技能\n---\n技能正文",
          references: [],
          sourceKind: "builtin-package",
          suggestedTools: ["read_file"],
          tags: ["builtin"],
          validation: {
            errors: [],
            isValid: true,
            warnings: [],
          },
        },
      ],
      status: "ready",
    });
    vi.mocked(scanInstalledSkills).mockReset();
  });

  it("切换技能启用状态", () => {
    const skillId = getResolvedSkills(useSkillsStore.getState())[0].id;
    useSkillsStore.getState().toggleSkill(skillId);

    expect(getResolvedSkills(useSkillsStore.getState())[0].enabled).toBe(true);
  });

  it("hydrate 后使用扫描结果", async () => {
    vi.mocked(scanInstalledSkills).mockResolvedValue([
      {
        body: "技能正文",
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

    await useSkillsStore.getState().hydrate();

    const skills = getResolvedSkills(useSkillsStore.getState());
    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe("zip-skill");
  });

  it("返回启用技能列表", () => {
    const skillId = getResolvedSkills(useSkillsStore.getState())[0].id;
    useSkillsStore.getState().toggleSkill(skillId);

    expect(getEnabledSkills(useSkillsStore.getState()).map((skill) => skill.id)).toContain(skillId);
  });
});

