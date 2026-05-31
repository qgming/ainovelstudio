// CP-E：用 pi 原生 loadSkills 从真实 skills 目录加载技能，过滤出启用项供 harness。
//
// loadSkills(env, dirs) 遍历 skills 目录读取每个 <id>/SKILL.md，产出 pi Skill[]
// （name/description/content/filePath）。我们按目录名(=skill id)过滤出启用的技能，
// 注入 harness.resources.skills；系统提示用 pi formatSkillsForSystemPrompt 渲染。
//
// 启用状态由 useSkillsStore 偏好维护（enabledById），与技能内容解耦，故这里只收 enabledIds。

import { loadSkills, type Skill } from "@earendil-works/pi-agent-core";
import { createSkillExecutionEnv } from "../env/skillExecutionEnv";

// 从 loadSkills 产出的 filePath（形如 "<id>/SKILL.md"）反推 skill id（首段目录名）。
function skillIdFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.split("/")[0] ?? "";
}

export type LoadNovelSkillsResult = {
  /** 启用的技能（已按 enabledIds 过滤），注入 harness.resources.skills。 */
  skills: Skill[];
};

/**
 * 从 app_data_dir/skills/ 加载全部技能，过滤出启用项。
 * skillsDir 用空串：skillExecutionEnv 的根即 skills 目录。
 */
export async function loadNovelSkills(enabledIds: string[]): Promise<LoadNovelSkillsResult> {
  const env = createSkillExecutionEnv();
  const enabled = new Set(enabledIds);
  const { skills } = await loadSkills(env, "");
  const filtered = skills.filter((skill) => enabled.has(skillIdFromFilePath(skill.filePath)));
  return { skills: filtered };
}
