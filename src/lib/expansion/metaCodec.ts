/**
 * 扩写工作区元数据 / JSON 标签 / ID 编解码工具集合。
 *
 * 之前内联在 ExpansionDetailPage 顶部 ~180 行纯函数，与组件渲染和状态混在一起。
 * 抽到 lib 层让组件只关心 UI、state 和事件编排。
 */

import { serializeJson } from "./templates";
import type { ChapterJson, SettingJson } from "./types";

export const HIDDEN_CHAPTER_META_PATH = "chapters.meta.json";
export const HIDDEN_SETTING_META_PATH = "settings.meta.json";
export const DEFAULT_SETTING_CATEGORIES = [
  "人物",
  "势力",
  "地点",
  "世界观",
  "道具",
  "其他",
];

/** 任意错误转换为对用户可读的中文文本。 */
export function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

/** 项目条目用人类可读标签：识别常用名（AGENTS / 大纲）。 */
export function getProjectEntryLabel(path: string): string {
  if (path === "AGENTS.md") return "代理规则 · AGENTS.md";
  if (/outline/i.test(path) || /大纲/.test(path)) return `故事大纲 · ${path}`;
  return path;
}

/** 仅保留数字字符。 */
export function normalizeNumericId(value: string): string {
  return value.replace(/\D+/g, "");
}

/** 把分卷 ID 规范化为 3 位数字（不足前补 0），无数字返回空串。 */
export function normalizeVolumeId(value: string): string {
  const digits = normalizeNumericId(value);
  return digits ? digits.padStart(3, "0") : "";
}

/** 设定分类去除首尾空白。 */
export function normalizeSettingCategory(value: string): string {
  return value.trim();
}

/** 标准化设定 JSON：保证 id 数字、name trim。 */
export function sanitizeSettingJson(value: SettingJson): SettingJson {
  return {
    id: normalizeNumericId(value.id),
    name: value.name.trim(),
    content: value.content,
  };
}

/** 标准化章节 JSON：保证 id 数字、name trim。 */
export function sanitizeChapterJson(value: ChapterJson): ChapterJson {
  return {
    id: normalizeNumericId(value.id),
    name: value.name.trim(),
    outline: value.outline,
    content: value.content,
  };
}

/** 章节展示标签："第 X 章 · 名称"。 */
export function buildChapterTargetLabel(
  chapter: ChapterJson | null,
  fallbackName: string | null,
): string {
  const name = chapter?.name?.trim() || fallbackName?.trim() || "未命名章节";
  const id = chapter?.id?.trim() ?? "";
  return id ? `第 ${id} 章 · ${name}` : name;
}

/** 章节列表项标签：在标题前加 "第 X 章 ·"。 */
export function buildChapterEntryLabel(
  entryId: string | null | undefined,
  name: string,
): string {
  const normalizedName = name.trim() || "未命名章节";
  const normalizedId = entryId?.trim() ?? "";
  return normalizedId ? `第 ${normalizedId} 章 · ${normalizedName}` : normalizedName;
}

/** 从章节路径推断分卷 ID；不含 / 时默认 001 卷。 */
export function getChapterVolumeId(path: string): string {
  return path.includes("/") ? normalizeVolumeId(path.split("/")[0] ?? "") : "001";
}

/** 从设定路径推断分类；不含 / 时归到 "其他"。 */
export function getSettingCategory(path: string): string {
  const category = path.includes("/") ? (path.split("/")[0] ?? "") : "";
  return normalizeSettingCategory(category) || "其他";
}

function getSettingBaseName(path: string): string {
  return path.includes("/") ? (path.split("/").at(-1) ?? path) : path;
}

/** 从设定路径推断 entryId（基名第一个 - 之前的部分）。 */
export function getSettingEntryId(path: string): string {
  return getSettingBaseName(path).split("-")[0] ?? "";
}

/** 从设定路径推断默认显示名（基名第一个 - 之后的部分）。 */
export function getSettingFallbackName(path: string): string {
  const baseName = getSettingBaseName(path);
  const fallbackName = baseName.split("-").slice(1).join("-").trim();
  return fallbackName || baseName;
}

/** 解析 chapters.meta.json 中已声明的分卷 ID 列表。 */
export function parseChapterMeta(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { volumes?: unknown };
    if (!Array.isArray(parsed.volumes)) return [];
    return Array.from(
      new Set(
        parsed.volumes
          .filter((item): item is string => typeof item === "string")
          .map((item) => normalizeVolumeId(item))
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }
}

/** 解析 settings.meta.json 中已声明的分类列表。 */
export function parseSettingMeta(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { categories?: unknown };
    if (!Array.isArray(parsed.categories)) return [];
    return parsed.categories
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeSettingCategory(item))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 序列化 chapters.meta.json，保证去重 + 升序。 */
export function buildVolumeMetaContent(volumeIds: string[]): string {
  return serializeJson({
    volumes: Array.from(
      new Set(volumeIds.map((item) => normalizeVolumeId(item)).filter(Boolean)),
    ).sort(),
  });
}

/** 设定分类排序：默认分类按内置顺序优先，其余按中文 locale。 */
export function sortSettingCategories(categories: string[]): string[] {
  const unique = Array.from(
    new Set(categories.map((item) => normalizeSettingCategory(item)).filter(Boolean)),
  );
  return unique.sort((left, right) => {
    const leftIndex = DEFAULT_SETTING_CATEGORIES.indexOf(left);
    const rightIndex = DEFAULT_SETTING_CATEGORIES.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right, "zh-Hans-CN");
  });
}

/** 序列化 settings.meta.json，含默认分类的合并去重排序。 */
export function buildSettingMetaContent(categories: string[]): string {
  return serializeJson({
    categories: sortSettingCategories([...DEFAULT_SETTING_CATEGORIES, ...categories]),
  });
}

/** 阿拉伯数字转中文（仅支持 4 位以内，足够"卷"使用场景）。 */
export function toChineseNumber(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const raw = String(value);
  let result = "";

  for (let index = 0; index < raw.length; index += 1) {
    const digit = Number(raw[index]);
    const unitIndex = raw.length - index - 1;
    if (digit === 0) {
      if (
        result &&
        !result.endsWith("零") &&
        raw
          .slice(index + 1)
          .split("")
          .some((char) => char !== "0")
      ) {
        result += "零";
      }
      continue;
    }
    if (digit === 1 && unitIndex === 1 && result === "") {
      result += units[unitIndex];
      continue;
    }
    result += `${digits[digit]}${units[unitIndex] ?? ""}`;
  }

  return result || digits[0];
}

/** 把 "001" 之类的卷 id 转为"第一卷"等中文显示。 */
export function formatVolumeLabel(volumeId: string): string {
  const numeric = Number.parseInt(volumeId, 10);
  return Number.isFinite(numeric) && numeric > 0
    ? `第${toChineseNumber(numeric)}卷`
    : `${volumeId}卷`;
}

/** 计算下一个新卷 ID（最大值 + 1，3 位补零）。 */
export function getNextVolumeId(volumeIds: string[]): string {
  const maxValue = volumeIds.reduce((currentMax, volumeId) => {
    const numeric = Number.parseInt(volumeId, 10);
    return Number.isFinite(numeric) ? Math.max(currentMax, numeric) : currentMax;
  }, 0);
  return String(maxValue + 1).padStart(3, "0");
}
