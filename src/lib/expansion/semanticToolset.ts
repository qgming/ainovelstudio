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
  linkedSettingIds?: string[];
  name: string;
  notes?: string;
  outline?: string;
  volumeId?: string;
};

type SettingDraftInput = {
  content?: string;
  linkedChapterIds?: string[];
  name: string;
  notes?: string;
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
  return path.split("-")[0] ?? "";
}

function getChapterVolumeId(path: string) {
  return path.includes("/") ? path.split("/")[0] ?? "001" : "001";
}

function normalizeChapterDraft(draft: ChapterDraftInput, fallbackId: string): ChapterJson {
  const normalizedName = normalizeDraftName(draft.name);
  const chapter = createDefaultChapter(fallbackId, normalizedName);
  return {
    ...chapter,
    name: normalizedName,
    outline: draft.outline ?? "",
    content: draft.content ?? "",
    notes: draft.notes ?? "",
    linkedSettingIds: draft.linkedSettingIds ?? [],
  };
}

function mergeChapter(current: ChapterJson, patch: Partial<ChapterJson>) {
  return {
    ...current,
    ...patch,
  };
}

function normalizeSettingDraft(draft: SettingDraftInput, fallbackId: string): SettingJson {
  const normalizedName = normalizeDraftName(draft.name);
  const setting = createDefaultSetting(fallbackId, normalizedName);
  return {
    ...setting,
    name: normalizedName,
    content: draft.content ?? "",
    notes: draft.notes ?? "",
    linkedChapterIds: draft.linkedChapterIds ?? [],
  };
}

function mergeUniqueStrings(current: string[], next?: string[]) {
  return Array.from(new Set([...(current ?? []), ...(next ?? [])].filter(Boolean)));
}

function mergeSetting(current: SettingJson, patch: Partial<SettingJson>) {
  return {
    ...current,
    ...patch,
    linkedChapterIds: mergeUniqueStrings(current.linkedChapterIds, patch.linkedChapterIds),
  };
}

function inferOutlineEntries(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^#{1,6}\s+/.test(line) || /^第.+章/.test(line) || /^\d+[.\-、]/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^\d+[.\-、]\s*/, "").trim())
    .filter(Boolean);
}

async function readProjectOutline(workspaceId: string) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  const outlineEntry =
    detail.projectEntries.find((entry) => /outline|大纲/i.test(entry.path)) ??
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
  const existing = detail.settingEntries.find((entry) => entry.name === normalizedName);
  if (existing) {
    return existing;
  }
  return createExpansionEntry(workspaceId, "settings", normalizedName);
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

async function listSettingEntries(workspaceId: string) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  return detail.settingEntries;
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
              outline: `${name}的章节细纲待完善。`,
              content: "",
              notes: "",
              linkedSettingIds: [],
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
      description: "回写章节正文与关联设定。",
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
        const next = mergeChapter(current, {
          content: ensureString(input.content, "content"),
          linkedSettingIds: Array.isArray(input.linkedSettingIds)
            ? (input.linkedSettingIds as string[])
            : undefined,
          notes: typeof input.notes === "string" ? input.notes : undefined,
          outline: typeof input.outline === "string" ? input.outline : undefined,
        });
        await writeExpansionEntry(workspaceId, "chapters", entry.path, serializeJson(next));
        await onWorkspaceMutated?.();
        return ok(`已写入章节 ${entry.path}。`, {
          chapterPath: entry.path,
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
      description: "根据章节推进结果更新设定。",
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
            detail.settingEntries.find((entry) => entry.name === patch.name);

          const entry = matched ?? (await createExpansionEntry(workspaceId, "settings", patch.name));
          const current = matched
            ? parseSettingJson(
                await readExpansionEntry(workspaceId, "settings", entry.path),
                getEntryId(entry.path),
                entry.name,
              )
            : createDefaultSetting(getEntryId(entry.path), patch.name);
          const next = mergeSetting(current, normalizeSettingDraft(patch, current.id));
          await writeExpansionEntry(workspaceId, "settings", entry.path, serializeJson(next));
          writtenPaths.push(entry.path);
        }

        await onWorkspaceMutated?.();
        return ok(`已更新 ${writtenPaths.length} 个设定文件。`, { settingPaths: writtenPaths });
      },
    },
    expansion_continuity_scan: {
      description: "扫描章节和设定之间的关联缺失。",
      execute: async () => {
        const chapters = await listChapterDocs(workspaceId);
        const settingEntries = await listSettingEntries(workspaceId);
        const settingIds = new Set(settingEntries.map((entry) => entry.entryId ?? getEntryId(entry.path)));
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

          for (const settingId of chapter.linkedSettingIds) {
            if (!settingIds.has(settingId)) {
              issues.push({
                type: "setting_reference",
                severity: "medium",
                message: `章节 ${entry.path} 引用了不存在的设定 ${settingId}。`,
              });
            }
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
