import type { ManualTurnContextPayload } from "../manualTurnContext";
import type { ProjectContextPayload } from "../projectContext";
import { createMiddleExcerpt, MANUAL_CONTEXT_FILE_CHAR_LIMIT } from "./shared";

export function buildManualContextBlock(
  manualContext?: ManualTurnContextPayload | null,
) {
  if (!manualContext) {
    return null;
  }

  const blocks: string[] = [];

  if (manualContext.skills.length > 0) {
    blocks.push(
      [
        "### 手动指定技能",
        ...manualContext.skills.map(
          (skill) => `- ${skill.name}：${skill.description}`,
        ),
        "- 这些 skill 当前仅以目录信息注入；执行匹配任务前必须用 skill_read 读取对应 SKILL.md。",
      ].join("\n"),
    );
  }

  if (manualContext.files.length > 0) {
    blocks.push(
      [
        "### 手动指定文件",
        "- 用户仅引用这些文件路径，系统不会自动注入文件正文；需要内容时按路径调用 workspace_read 读取最小必要范围。",
        ...manualContext.files.map((file) => `- ${file.path}`),
      ].join("\n\n"),
    );
  }

  if (blocks.length === 0) {
    return null;
  }

  return [
    "以下资源由用户在本轮手动指定，应优先纳入分析与执行上下文。",
    ...blocks,
  ].join("\n\n");
}

export function buildProjectContextBlock(
  projectContext?: ProjectContextPayload | null,
) {
  if (!projectContext || projectContext.files.length === 0) {
    return null;
  }

  return [
    "以下资源属于工作区默认项目上下文。进入对话时系统会优先注入，用于帮助你快速了解项目。",
    ...projectContext.files.map((file) => {
      if (!file.content?.trim()) {
        const isRelationFile = file.description?.startsWith("[关联文件 · ") ?? false;
        return [
          `### ${file.name}`,
          `- 路径：${file.path}`,
          file.description ? `- 说明：${file.description}` : null,
          "- 注入方式：仅路径提示，未注入文件正文；需要内容时请按路径调用 workspace_read 读取最小必要范围。",
          isRelationFile
            ? "- 来源:作者已显式建立的关联,涉及当前 active file 的剧情/设定链路,优先 read 而非 search。"
            : null,
        ].filter(Boolean).join("\n");
      }

      const excerpt = createMiddleExcerpt(file.content, MANUAL_CONTEXT_FILE_CHAR_LIMIT);
      return [
        `### ${file.name}`,
        `- 路径：${file.path}`,
        excerpt.truncated
          ? `- 注入方式：已裁剪摘录，约省略 ${excerpt.omittedChars} 个字符；如需全文请再用 workspace_read 读取。`
          : "- 注入方式：已直接注入当前文件内容。",
        "```text",
        excerpt.text,
        "```",
      ].join("\n");
    }),
  ].join("\n\n");
}
