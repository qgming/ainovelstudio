import type { ManualTurnContextPayload } from "../manualTurnContext";
import type { ProjectContextPayload } from "../projectContext";
import { createMiddleExcerpt, MANUAL_CONTEXT_FILE_CHAR_LIMIT, MANUAL_CONTEXT_TOTAL_CHAR_LIMIT } from "./shared";

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
        "- 这些 skill 当前仅以目录信息注入；需要完整步骤时，请再读取对应 SKILL.md。",
      ].join("\n"),
    );
  }

  if (manualContext.files.length > 0) {
    let remainingChars = MANUAL_CONTEXT_TOTAL_CHAR_LIMIT;
    const renderedFiles: string[] = [];

    for (const file of manualContext.files) {
      if (remainingChars <= 0) {
        break;
      }

      const allocatedChars = Math.min(
        MANUAL_CONTEXT_FILE_CHAR_LIMIT,
        remainingChars,
      );
      const excerpt = createMiddleExcerpt(file.content, allocatedChars);
      remainingChars -= Math.min(file.content.trim().length, allocatedChars);

      renderedFiles.push(
        [
          `#### ${file.name}`,
          `- 路径：${file.path}`,
          excerpt.truncated
            ? `- 注入方式：已裁剪摘录，约省略 ${excerpt.omittedChars} 个字符；如需全文请再用 read 读取。`
            : "- 注入方式：已直接注入当前文件内容。",
          "```text",
          excerpt.text,
          "```",
        ].join("\n"),
      );
    }

    const omittedFileCount = manualContext.files.length - renderedFiles.length;
    blocks.push(
      [
        "### 手动指定文件",
        ...renderedFiles,
        omittedFileCount > 0
          ? `- 另外还有 ${omittedFileCount} 个手动文件未直接注入，以控制上下文体积；需要时请按路径调用 read。`
          : null,
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
      const excerpt = createMiddleExcerpt(file.content, MANUAL_CONTEXT_FILE_CHAR_LIMIT);
      return [
        `### ${file.name}`,
        `- 路径：${file.path}`,
        excerpt.truncated
          ? `- 注入方式：已裁剪摘录，约省略 ${excerpt.omittedChars} 个字符；如需全文请再用 read 读取。`
          : "- 注入方式：已直接注入当前文件内容。",
        "```text",
        excerpt.text,
        "```",
      ].join("\n");
    }),
  ].join("\n\n");
}
