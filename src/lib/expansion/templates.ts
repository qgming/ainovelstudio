import type { ChapterJson, SettingJson } from "./types";

export function createDefaultSetting(id: string, name: string): SettingJson {
  return {
    id,
    name,
    content: "",
  };
}

export function createDefaultChapter(id: string, name: string): ChapterJson {
  return {
    id,
    name,
    outline: "",
    content: "",
  };
}

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
  return Array.from(text.replace(/\s+/g, "")).length;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumericString(value: unknown, fallback = ""): string {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return fallback;
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

  return {
    id: asNumericString(parsed.id, fallbackId),
    name: asString(parsed.name, fallbackName),
    content: asString(parsed.content),
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

  return {
    id: asNumericString(parsed.id, fallbackId),
    name: asString(parsed.name, fallbackName),
    outline: asString(parsed.outline),
    content: asString(parsed.content),
  };
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
