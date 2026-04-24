import type {
  ChapterJson,
  ChapterStatus,
  SettingJson,
  SettingType,
} from "./types";

const SETTING_TYPES: SettingType[] = ["人物", "物品", "地点", "势力", "概念"];
const CHAPTER_STATUSES: ChapterStatus[] = [
  "draft",
  "outlined",
  "drafted",
  "revised",
  "done",
];

export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  draft: "草稿",
  outlined: "已写细纲",
  drafted: "已写正文",
  revised: "已修订",
  done: "已完成",
};

export function createDefaultSetting(id: string, name: string): SettingJson {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    name,
    type: "人物",
    aliases: [],
    tags: [],
    summary: "",
    description: "",
    attributes: {},
    relations: [],
    appearChapters: [],
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultChapter(id: string, name: string): ChapterJson {
  const now = Math.floor(Date.now() / 1000);
  const order = parseInt(id, 10) || 1;
  return {
    id,
    name,
    order,
    status: "draft",
    summary: "",
    linkedSettingIds: [],
    outline: "",
    content: "",
    charCount: 0,
    wordCount: 0,
    pov: "",
    location: "",
    timeline: "",
    events: [],
    foreshadowing: [],
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

// 中文字符数（去除空白与标点的近似实现：仅统计 CJK 区段）
export function countChineseChars(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df)
    ) {
      count += 1;
    }
  }
  return count;
}

export function countWords(text: string): number {
  if (!text) return 0;
  // 统计去掉空白与换行后的总字符
  return Array.from(text.replace(/\s+/g, "")).length;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseSettingJson(
  raw: string,
  fallbackId: string,
  fallbackName: string,
): SettingJson {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return createDefaultSetting(fallbackId, fallbackName);
  }

  const type = SETTING_TYPES.includes(parsed.type as SettingType)
    ? (parsed.type as SettingType)
    : "人物";

  const attributes: Record<string, string> = {};
  if (parsed.attributes && typeof parsed.attributes === "object") {
    for (const [key, value] of Object.entries(
      parsed.attributes as Record<string, unknown>,
    )) {
      if (typeof value === "string") attributes[key] = value;
    }
  }

  const relations = Array.isArray(parsed.relations)
    ? (parsed.relations as Array<Record<string, unknown>>)
        .map((item) => ({
          targetId: asString(item.targetId),
          targetName: asString(item.targetName),
          relation: asString(item.relation),
        }))
        .filter((item) => item.targetId || item.targetName || item.relation)
    : [];

  return {
    id: asString(parsed.id, fallbackId),
    name: asString(parsed.name, fallbackName),
    type,
    aliases: asStringArray(parsed.aliases),
    tags: asStringArray(parsed.tags),
    summary: asString(parsed.summary),
    description: asString(parsed.description),
    attributes,
    relations,
    appearChapters: asStringArray(parsed.appearChapters),
    notes: asString(parsed.notes),
    createdAt: asNumber(parsed.createdAt),
    updatedAt: asNumber(parsed.updatedAt),
  };
}

export function parseChapterJson(
  raw: string,
  fallbackId: string,
  fallbackName: string,
): ChapterJson {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return createDefaultChapter(fallbackId, fallbackName);
  }

  const status = CHAPTER_STATUSES.includes(parsed.status as ChapterStatus)
    ? (parsed.status as ChapterStatus)
    : "draft";

  const events = Array.isArray(parsed.events)
    ? (parsed.events as Array<Record<string, unknown>>).map((item) => ({
        title: asString(item.title),
        detail: asString(item.detail),
      }))
    : [];

  const foreshadowing = Array.isArray(parsed.foreshadowing)
    ? (parsed.foreshadowing as Array<Record<string, unknown>>).map((item) => ({
        title: asString(item.title),
        detail: asString(item.detail),
        payoffChapterId:
          typeof item.payoffChapterId === "string" ? item.payoffChapterId : null,
      }))
    : [];

  return {
    id: asString(parsed.id, fallbackId),
    name: asString(parsed.name, fallbackName),
    order: asNumber(parsed.order, parseInt(fallbackId, 10) || 1),
    status,
    summary: asString(parsed.summary),
    linkedSettingIds: asStringArray(parsed.linkedSettingIds),
    outline: asString(parsed.outline),
    content: asString(parsed.content),
    charCount: asNumber(parsed.charCount),
    wordCount: asNumber(parsed.wordCount),
    pov: asString(parsed.pov),
    location: asString(parsed.location),
    timeline: asString(parsed.timeline),
    events,
    foreshadowing,
    notes: asString(parsed.notes),
    createdAt: asNumber(parsed.createdAt),
    updatedAt: asNumber(parsed.updatedAt),
  };
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
