import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { skillLabel } from "@features/skills/stores/useSkillsStore";
import { ALL_TOOL_SPECS } from "../pi/tool-bridge/schemas";
import type { PiToolSpec } from "../pi/tool-bridge/types";
import { ALL_TOOL_DEFS, normalizeSuggestedToolIds } from "../domain/toolDefs";
import { joinSections } from "./shared";

const TOOL_SPECS: Record<string, PiToolSpec> = ALL_TOOL_SPECS;

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

// 工具的完整参数 schema 已通过 pi 原生 tools 字段传给模型，无需在系统提示里复述。
// 这里只保留「工具名（id）+ 一句话用途」作为发现/选择索引，避免与 tools 字段重复占 token。
function firstSentence(description: string): string {
  const trimmed = description.trim();
  const stop = trimmed.search(/[。.\n]/);
  return stop > 0 ? trimmed.slice(0, stop).trim() : trimmed;
}

function buildToolBlock(toolId: string) {
  const toolDef = ALL_TOOL_DEFS.find((tool) => tool.id === toolId);
  const spec = TOOL_SPECS[toolId];
  if (!toolDef || !spec) {
    return null;
  }
  return `- ${toolDef.name}（${toolId}）：${firstSentence(spec.description)}`;
}

function buildSkillBlock(skill: ResolvedSkill) {
  const description = readFrontmatterString(skill, "description") ?? skill.description;
  const suggestedTools = normalizeSuggestedToolIds(skill.suggestedTools);
  // 标题优先显示中文名(displayName),便于模型理解用途;id 单列供 skill_read 调用。
  return [
    `### 技能：${skillLabel(skill)}`,
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
          "以下是当前可用工具的索引（名称 + 一句话用途）。完整参数 schema 已随原生工具定义提供，按需直接调用即可。",
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

