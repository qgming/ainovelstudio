import type { AgentTool } from "../agent/runtime";
import { ensureString, ok } from "../agent/tools/shared";
import {
  createExpansionEntry,
  getExpansionWorkspaceDetail,
  readExpansionEntry,
  writeExpansionEntry,
} from "./api";
import {
  createDefaultChapter,
  createDefaultSetting,
  parseChapterJson,
  parseSettingJson,
  serializeJson,
} from "./templates";
import type { ChapterJson, SettingJson } from "./types";

type ExpansionSemanticToolsetInput = {
  onWorkspaceMutated?: () => Promise<void>;
  workspaceId: string;
};

type ChapterDraftInput = {
  content?: string;
  name: string;
  outline?: string;
  volumeId?: string;
};

type SettingDraftInput = {
  category?: string;
  content?: string;
  name: string;
};

type ChapterFieldUpdate = {
  field: "content" | "outline";
  mode?: "append" | "replace";
  separator?: string;
  value: string;
};

function normalizeDraftName(name: string) {
  return name
    .trim()
    .replace(/^\d+\s*[-._、:：]\s*/u, "")
    .replace(/^\d+\s+/u, "")
    .replace(/^\s*第\s*[0-9零一二三四五六七八九十百千两〇]+(?:\s*[章节回幕部卷集])\s*[-._、:：]?\s*/u, "")
    .trim();
}

function getEntryId(path: string) {
  const baseName = path.includes("/") ? (path.split("/").at(-1) ?? path) : path;
  return baseName.split("-")[0] ?? "";
}

function getChapterVolumeId(path: string) {
  return path.includes("/") ? path.split("/")[0] ?? "001" : "001";
}

function getSettingCategory(path: string) {
  return path.includes("/") ? path.split("/")[0] ?? "其他" : "其他";
}

function normalizeChapterDraft(draft: ChapterDraftInput, fallbackId: string): ChapterJson {
  const normalizedName = normalizeDraftName(draft.name);
  const chapter = createDefaultChapter(fallbackId, normalizedName);
  return {
    ...chapter,
    name: normalizedName,
    outline: draft.outline ?? "",
    content: draft.content ?? "",
  };
}

function mergeChapter(current: ChapterJson, patch: Partial<ChapterJson>) {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  };
}

function normalizeSettingDraft(draft: SettingDraftInput, fallbackId: string): SettingJson {
  const normalizedName = normalizeDraftName(draft.name);
  const setting = createDefaultSetting(fallbackId, normalizedName);
  return {
    ...setting,
    name: normalizedName,
    content: draft.content ?? "",
  };
}

function mergeSetting(current: SettingJson, patch: Partial<SettingJson>) {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  };
}

function normalizeSettingPatch(draft: SettingDraftInput): Partial<SettingJson> {
  return {
    content: typeof draft.content === "string" ? draft.content : undefined,
    name: normalizeDraftName(draft.name),
  };
}

function applyMarkdownFieldUpdate(currentValue: string, update: ChapterFieldUpdate) {
  if (update.mode === "append") {
    if (!currentValue) {
      return update.value;
    }
    const separator = typeof update.separator === "string" ? update.separator : "\n\n";
    return `${currentValue}${separator}${update.value}`;
  }
  return update.value;
}

function normalizeChapterFieldUpdates(input: Record<string, unknown>) {
  const updates: ChapterFieldUpdate[] = [];
  if (Array.isArray(input.updates)) {
    for (const [index, item] of input.updates.entries()) {
      if (!item || typeof item !== "object") {
        throw new Error(`updates[${index}] 必须是对象。`);
      }
      const record = item as Record<string, unknown>;
      const field = record.field === "outline" ? "outline" : "content";
      const value = ensureString(record.value, `updates[${index}].value`);
      const mode = record.mode === "append" ? "append" : "replace";
      updates.push({
        field,
        mode,
        separator: typeof record.separator === "string" ? record.separator : undefined,
        value,
      });
    }
  }

  if (typeof input.content === "string" && input.content.trim()) {
    updates.push({
      field: input.field === "outline" ? "outline" : "content",
      mode: input.mode === "append" ? "append" : "replace",
      separator: typeof input.separator === "string" ? input.separator : undefined,
      value: ensureString(input.content, "content"),
    });
  }

  if (typeof input.outline === "string" && input.outline.trim()) {
    updates.push({
      field: "outline",
      mode: "replace",
      value: ensureString(input.outline, "outline"),
    });
  }

  if (updates.length === 0) {
    throw new Error("至少需要提供 content、outline 或 updates。");
  }
  return updates;
}

function inferOutlineEntries(content: string) {
  const chapterTitleCore =
    "(?:第.+章(?:$|[\\s：:·\\-].*)|序章(?:$|[\\s：:·\\-].*)|终章(?:$|[\\s：:·\\-].*)|尾声(?:$|[\\s：:·\\-].*)|番外(?:$|[\\s：:·\\-].*))";
  const chapterLikeHeadingPattern = new RegExp(`^#{1,6}\\s*${chapterTitleCore}`);
  const chapterLikeListPattern = new RegExp(`^[-*]\\s*${chapterTitleCore}`);
  const chapterLikeNumberedPattern = new RegExp(`^\\d+[.\\-、]\\s*${chapterTitleCore}`);

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      chapterLikeHeadingPattern.test(line)
      || chapterLikeListPattern.test(line)
      || /^第.+章/.test(line)
      || chapterLikeNumberedPattern.test(line),
    )
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*]\s*/, "")
        .replace(/^\d+[.\-、]\s*/, "")
        .trim(),
    )
    .filter(Boolean);
}

async function readProjectOutline(workspaceId: string) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  const outlineEntry =
    detail.projectEntries.find((entry) => /outline|大纲/i.test(entry.path)) ??
    detail.projectEntries.find((entry) => entry.path === "README.md") ??
    detail.projectEntries.find((entry) => entry.path === "AGENTS.md") ??
    detail.projectEntries[0];

  if (!outlineEntry) {
    return "";
  }

  return readExpansionEntry(workspaceId, "project", outlineEntry.path);
}

async function ensureChapterEntry(
  workspaceId: string,
  draft: ChapterDraftInput,
  targetVolumeId: string,
) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  const existing = detail.chapterEntries.find(
    (entry) =>
      getChapterVolumeId(entry.path) === targetVolumeId &&
      entry.name === normalizeDraftName(draft.name),
  );

  if (existing) {
    return existing;
  }

  return createExpansionEntry(
    workspaceId,
    "chapters",
    normalizeDraftName(draft.name),
    targetVolumeId,
  );
}

async function ensureSettingEntry(workspaceId: string, draft: SettingDraftInput) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  const normalizedName = normalizeDraftName(draft.name);
  const targetCategory =
    typeof draft.category === "string" && draft.category.trim() ? draft.category.trim() : "其他";
  const existing = detail.settingEntries.find(
    (entry) => entry.name === normalizedName && getSettingCategory(entry.path) === targetCategory,
  );
  if (existing) {
    return existing;
  }
  return createExpansionEntry(workspaceId, "settings", normalizedName, targetCategory);
}

async function listChapterDocs(workspaceId: string) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  return Promise.all(
    detail.chapterEntries.map(async (entry) => ({
      entry,
      chapter: parseChapterJson(
        await readExpansionEntry(workspaceId, "chapters", entry.path),
        entry.entryId ?? "",
        entry.name,
      ),
    })),
  );
}

export function createExpansionSemanticToolset({
  onWorkspaceMutated,
  workspaceId,
}: ExpansionSemanticToolsetInput): Record<string, AgentTool> {
  return {
    expansion_chapter_batch_outline: {
      description: "根据大纲批量创建章节结构化 JSON。",
      execute: async (input) => {
        const targetVolumeId =
          typeof input.volumeId === "string" && input.volumeId.trim()
            ? input.volumeId.trim()
            : "001";
        const drafts = Array.isArray(input.chapters)
          ? (input.chapters as ChapterDraftInput[])
          : inferOutlineEntries(await readProjectOutline(workspaceId)).map<ChapterDraftInput>((name) => ({
              name,
              outline: `## 情节点\n\n- ${name}的章节细纲待完善。`,
              content: "",
            }));

        const createdPaths: string[] = [];
        for (const [index, draft] of drafts.entries()) {
          const volumeId =
            typeof draft.volumeId === "string" && draft.volumeId.trim()
              ? draft.volumeId.trim()
              : targetVolumeId;
          const entry = await ensureChapterEntry(workspaceId, draft, volumeId);
          const next = normalizeChapterDraft(
            draft,
            entry.entryId ?? String(index + 1),
          );
          await writeExpansionEntry(workspaceId, "chapters", entry.path, serializeJson(next));
          createdPaths.push(entry.path);
        }

        await onWorkspaceMutated?.();
        return ok(`已批量写入 ${createdPaths.length} 个章节结构。`, {
          chapterPaths: createdPaths,
          rule: "章节 id 由程序自动递增分配；传入 name 时只写章节名称，不要带序号前缀。",
        });
      },
    },
    expansion_chapter_write_content: {
      description: "回写章节正文。",
      execute: async (input) => {
        const chapterRef = ensureString(input.chapterId ?? input.chapterPath, "chapterId");
        const detail = await getExpansionWorkspaceDetail(workspaceId);
        const entry =
          detail.chapterEntries.find((item) => item.path === chapterRef) ??
          detail.chapterEntries.find((item) => item.entryId === chapterRef);
        if (!entry) {
          throw new Error("未找到目标章节。");
        }

        const current = parseChapterJson(
          await readExpansionEntry(workspaceId, "chapters", entry.path),
          entry.entryId ?? "",
          entry.name,
        );
        const updates = normalizeChapterFieldUpdates(input);
        const next = updates.reduce((chapter, update) => {
          const currentValue = update.field === "outline" ? chapter.outline : chapter.content;
          return mergeChapter(chapter, {
            [update.field]: applyMarkdownFieldUpdate(currentValue, update),
          } as Partial<ChapterJson>);
        }, current);
        await writeExpansionEntry(workspaceId, "chapters", entry.path, serializeJson(next));
        await onWorkspaceMutated?.();
        return ok(`已写入章节 ${entry.path}。`, {
          chapterPath: entry.path,
          updatedFields: Array.from(new Set(updates.map((item) => item.field))),
        });
      },
    },
    expansion_setting_batch_generate: {
      description: "批量创建设定 JSON。",
      execute: async (input) => {
        const drafts = Array.isArray(input.settings)
          ? (input.settings as SettingDraftInput[])
          : ([] as SettingDraftInput[]);

        const writtenPaths: string[] = [];
        for (const draft of drafts) {
          const entry = await ensureSettingEntry(workspaceId, draft);
          const next = normalizeSettingDraft(draft, getEntryId(entry.path));
          await writeExpansionEntry(workspaceId, "settings", entry.path, serializeJson(next));
          writtenPaths.push(entry.path);
        }

        await onWorkspaceMutated?.();
        return ok(`已批量写入 ${writtenPaths.length} 个设定文件。`, {
          settingPaths: writtenPaths,
          rule: "设定 id 由程序自动递增分配；传入 name 时只写设定名称，不要带序号前缀。",
        });
      },
    },
    expansion_setting_update_from_chapter: {
      description: "根据章节推进结果更新设定内容。",
      execute: async (input) => {
        const updates = Array.isArray(input.updates)
          ? (input.updates as Array<SettingDraftInput & { id?: string; path?: string }>)
          : [];
        const detail = await getExpansionWorkspaceDetail(workspaceId);
        const writtenPaths: string[] = [];

        for (const patch of updates) {
          const matched =
            (patch.path
              ? detail.settingEntries.find((entry) => entry.path === patch.path)
              : null) ??
            (patch.id
              ? detail.settingEntries.find((entry) => getEntryId(entry.path) === patch.id)
              : null) ??
            detail.settingEntries.find(
              (entry) =>
                entry.name === patch.name &&
                getSettingCategory(entry.path) ===
                  (typeof patch.category === "string" && patch.category.trim() ? patch.category.trim() : "其他"),
            );

          const entry =
            matched ??
            (await createExpansionEntry(
              workspaceId,
              "settings",
              patch.name,
              typeof patch.category === "string" && patch.category.trim() ? patch.category.trim() : "其他",
            ));
          const current = matched
            ? parseSettingJson(
                await readExpansionEntry(workspaceId, "settings", entry.path),
                getEntryId(entry.path),
                entry.name,
              )
            : createDefaultSetting(getEntryId(entry.path), patch.name);
          const next = mergeSetting(current, normalizeSettingPatch(patch));
          await writeExpansionEntry(workspaceId, "settings", entry.path, serializeJson(next));
          writtenPaths.push(entry.path);
        }

        await onWorkspaceMutated?.();
        return ok(`已更新 ${writtenPaths.length} 个设定文件。`, { settingPaths: writtenPaths });
      },
    },
    expansion_continuity_scan: {
      description: "扫描章节编号冲突。",
      execute: async () => {
        const chapters = await listChapterDocs(workspaceId);
        const issues: Array<{ message: string; severity: "low" | "medium" | "high"; type: string }> = [];

        const seenIds = new Map<string, string>();
        for (const { entry, chapter } of chapters) {
          if (seenIds.has(chapter.id)) {
            issues.push({
              type: "chapter_id",
              severity: "high",
              message: `章节 ${entry.path} 与 ${seenIds.get(chapter.id)} 使用了相同的章节 id=${chapter.id}。`,
            });
          } else {
            seenIds.set(chapter.id, entry.path);
          }
        }

        return ok(`已完成连续性扫描，发现 ${issues.length} 个问题。`, {
          issues,
          totalIssues: issues.length,
        });
      },
    },
  };
}
