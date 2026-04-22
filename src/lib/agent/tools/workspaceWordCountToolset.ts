import { readWorkspaceTextFile } from "../../bookWorkspace/api";
import type { AgentTool } from "../runtime";
import {
  getAbortContext,
  ok,
  ensureString,
  type WorkspaceToolContext,
} from "./shared";

type TextCountStats = {
  path: string;
  characterCount: number;
  nonWhitespaceCharacterCount: number;
  chineseCharacterCount: number;
  latinWordCount: number;
  digitCount: number;
  lineCount: number;
  paragraphCount: number;
};

function countMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern)).length;
}

function computeTextCountStats(path: string, content: string): TextCountStats {
  const characters = Array.from(content);
  const normalized = content.replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    path,
    characterCount: characters.length,
    nonWhitespaceCharacterCount: characters.filter((char) => !/\s/u.test(char))
      .length,
    chineseCharacterCount: countMatches(content, /\p{Script=Han}/gu),
    latinWordCount: countMatches(content, /[A-Za-z]+(?:[’'-][A-Za-z]+)*/g),
    digitCount: countMatches(content, /\d/gu),
    lineCount: content.length === 0 ? 0 : normalized.split("\n").length,
    paragraphCount: paragraphs.length,
  };
}

function formatWordCountSummary(stats: TextCountStats) {
  return [
    `已统计 ${stats.path}：`,
    `- 字符数：${stats.characterCount}`,
    `- 非空白字符数：${stats.nonWhitespaceCharacterCount}`,
    `- 中文字符数：${stats.chineseCharacterCount}`,
    `- 英文单词数：${stats.latinWordCount}`,
    `- 数字数：${stats.digitCount}`,
    `- 行数：${stats.lineCount}`,
    `- 段落数：${stats.paragraphCount}`,
  ].join("\n");
}

export function createWorkspaceWordCountTools({
  rootPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    word_count: {
      description: "统计文本文件的字数和结构指标",
      execute: async (input, context) => {
        const path = ensureString(input.path, "word_count.path");
        const content = await readWorkspaceTextFile(
          rootPath,
          path,
          getAbortContext(context),
        );
        const stats = computeTextCountStats(path, content);
        return ok(formatWordCountSummary(stats), stats);
      },
    },
  };
}
