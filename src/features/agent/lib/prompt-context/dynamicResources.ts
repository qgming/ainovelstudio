import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { DATA_TOOL_SPECS } from "../ai-sdk-tools/dataBuilders";
import { INTERACTION_TOOL_SPECS } from "../ai-sdk-tools/interactionBuilders";
import { READ_TOOL_SPECS } from "../ai-sdk-tools/readBuilders";
import { renderToolParameters, type AgentToolPromptSpec } from "../ai-sdk-tools/toolPromptSpecs";
import { WRITE_TOOL_SPECS } from "../ai-sdk-tools/writeBuilders";
import { ALL_TOOL_DEFS, normalizeSuggestedToolIds } from "../toolDefs";
import { joinSections } from "./shared";

const TOOL_SPECS: Record<string, AgentToolPromptSpec> = {
  ...INTERACTION_TOOL_SPECS,
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
  if (skill.references.length === 1) {
    return `- 可读参考:${skill.references[0].path}`;
  }
  // 多个 references 时只汇总数量,避免占用 system 空间;
  // LLM 需要时调用 skill_read({action:'list'}) 获取完整列表。
  return `- 可读参考:共 ${skill.references.length} 个,使用 skill_read({action:'list'}) 查看完整列表。`;
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
          "以下是当前可用工具，说明来自真实 description 与参数 schema。",
          "涉及工作区时优先传相对路径，不要传绝对路径。",
          "",
          ...enabledToolBlocks,
        ].join("\n")
      : "- 当前未启用任何工作区工具。";

  const skillBody = !params.includeSkillCatalog
    ? null
    : params.enabledSkills.length > 0
      ? [
          "以下是当前启用的技能目录。目录只用于发现技能；任务明显匹配时，先读取完整 SKILL.md：",
          '  skill_read({ action: "read", skillId: "<id>", relativePath: "SKILL.md" })',
          "需要模板、例子或专项方法时，再按需读取 references/。",
          "",
          ...params.enabledSkills.map((skill) => buildSkillBlock(skill)),
        ].join("\n")
      : "- 当前未启用额外技能。";

  return joinSections([toolBody, skillBody]);
}

