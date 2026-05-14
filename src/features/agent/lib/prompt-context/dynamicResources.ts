import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { DATA_TOOL_SPECS } from "../ai-sdk-tools/dataBuilders";
import { INTERACTION_TOOL_SPECS } from "../ai-sdk-tools/interactionBuilders";
import { READ_TOOL_SPECS } from "../ai-sdk-tools/readBuilders";
import { renderToolParameters, type AgentToolPromptSpec } from "../ai-sdk-tools/toolPromptSpecs";
import { WRITE_TOOL_SPECS } from "../ai-sdk-tools/writeBuilders";
import { TASK_TOOL_SPEC } from "../taskTool";
import { ALL_TOOL_DEFS, normalizeSuggestedToolIds } from "../toolDefs";
import { joinSections } from "./shared";

const TOOL_SPECS: Record<string, AgentToolPromptSpec> = {
  ...INTERACTION_TOOL_SPECS,
  delegate_task: TASK_TOOL_SPEC,
  ...READ_TOOL_SPECS,
  ...WRITE_TOOL_SPECS,
  ...DATA_TOOL_SPECS,
};

function readFrontmatterString(skill: ResolvedSkill, key: string) {
  const value = skill.frontmatter?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildReferencePathList(skill: ResolvedSkill) {
  if (skill.references.length === 0) return null;
  return [
    "- 可读参考：",
    ...skill.references.map((reference) => `  - ${reference.path}`),
  ].join("\n");
}

function buildToolBlock(toolId: string) {
  const toolDef = ALL_TOOL_DEFS.find((tool) => tool.id === toolId);
  const spec = TOOL_SPECS[toolId];
  if (!toolDef || !spec) {
    return null;
  }

  const parameterLines = renderToolParameters(spec.inputSchema);
  return [
    `### 工具：${toolDef.name}（${toolId}）`,
    spec.description,
    parameterLines.length > 0 ? ["- 参数：", ...parameterLines].join("\n") : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSkillBlock(skill: ResolvedSkill) {
  const description = readFrontmatterString(skill, "description") ?? skill.description;
  const suggestedTools = normalizeSuggestedToolIds(skill.suggestedTools);
  return [
    `### 技能：${readFrontmatterString(skill, "name") ?? skill.name}`,
    `- id：${skill.id}`,
    `- 头部说明：${description}`,
    skill.tags.length > 0 ? `- 匹配关键词：${skill.tags.join(", ")}` : null,
    suggestedTools.length > 0 ? `- 常用工具：${suggestedTools.join(", ")}` : null,
    buildReferencePathList(skill),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDynamicResourceDirectory(params: {
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  includeSkillCatalog: boolean;
}) {
  const enabledToolBlocks = ALL_TOOL_DEFS
    .filter((tool) => params.enabledToolIds.includes(tool.id))
    .map((tool) => buildToolBlock(tool.id))
    .filter((block): block is string => Boolean(block));

  const toolBody =
    enabledToolBlocks.length > 0
      ? [
          "以下工具从当前启用工具的真实 description 与参数 schema 动态汇总。",
          "涉及工作区路径时，优先传相对工作区根目录的路径，不要传绝对路径（例如用 `05-完整大纲.md`，不要用 `C:/.../05-完整大纲.md`）。",
          "",
          ...enabledToolBlocks,
        ].join("\n")
      : "- 当前未启用任何工作区工具。";

  const skillBody = !params.includeSkillCatalog
    ? null
    : params.enabledSkills.length > 0
      ? [
          "以下技能目录从已启用技能的 SKILL.md 头部 frontmatter 动态汇总。目录只用于发现技能；任务明显匹配某个 skill 时，执行前必须用 skill_read 工具读取完整规则：",
          '  skill_read({ action: "read", skillId: "<id>", relativePath: "SKILL.md" })',
          "需要例子、模板或专项方法时，再按需读取 references/ 下的文件。",
          "",
          ...params.enabledSkills.map((skill) => buildSkillBlock(skill)),
        ].join("\n")
      : "- 当前未启用额外技能。";

  return joinSections([toolBody, skillBody]);
}

