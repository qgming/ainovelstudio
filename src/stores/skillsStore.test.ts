import { beforeEach, describe, expect, it } from "vitest";
import { useSkillsStore } from "./skillsStore";

describe("skills store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSkillsStore.getState().reset();
  });

  it("切换技能启用状态", () => {
    const skillId = useSkillsStore.getState().builtinSkills[0].id;
    useSkillsStore.getState().toggleSkill(skillId);

    expect(useSkillsStore.getState().builtinSkills[0].enabled).toBe(true);
  });
});
