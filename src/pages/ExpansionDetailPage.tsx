import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { Toast, type ToastTone } from "../components/common/Toast";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";
import {
  ChapterEditor,
  ProjectEditor,
  SettingEditor,
} from "../components/expansion/detail/ExpansionEditors";
import {
  ExpansionWorkspacePanel,
  type ExpansionWorkspaceActionButton,
  type ExpansionWorkspaceActionId,
  type ExpansionWorkspaceTask,
} from "../components/expansion/detail/ExpansionWorkspacePanel";
import { DialogShell } from "../components/dialogs/DialogShell";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { runAgentTurn } from "../lib/agent/session";
import { createGlobalToolset, createLocalResourceToolset } from "../lib/agent/tools";
import type { AgentPart, AgentRunStatus } from "../lib/agent/types";
import { mergePart } from "../lib/chat/sessionRuntime";
import { createExpansionAgentToolset } from "../lib/expansion/agentToolset";
import { createExpansionSemanticToolset } from "../lib/expansion/semanticToolset";
import {
  createExpansionEntry,
  deleteExpansionEntry,
  getExpansionWorkspaceDetail,
  readExpansionEntry,
  renameExpansionEntry,
  writeExpansionEntry,
} from "../lib/expansion/api";
import {
  parseChapterJson,
  parseSettingJson,
  serializeJson,
} from "../lib/expansion/templates";
import { buildExpansionListRoute } from "../lib/expansion/routes";
import type {
  ChapterJson,
  ExpansionSection,
  ExpansionWorkspaceDetail,
  SettingJson,
} from "../lib/expansion/types";
import { useIsMobile } from "../hooks/use-mobile";
import { cn } from "../lib/utils";
import { useAgentSettingsStore } from "../stores/agentSettingsStore";
import { getEnabledSkills, useSkillsStore } from "../stores/skillsStore";
import { getEnabledAgents, useSubAgentStore } from "../stores/subAgentStore";

type ToastState = { description?: string; title: string; tone: ToastTone };
type SelectedKey = { section: ExpansionSection; path: string } | null;
type LoadStatus = "loading" | "ready" | "error";
type ChapterVolumeGroup = {
  entries: ExpansionWorkspaceDetail["chapterEntries"];
  volumeId: string;
};
type SettingCategoryGroup = {
  category: string;
  entries: ExpansionWorkspaceDetail["settingEntries"];
};
type MobileExpansionTab = "context" | "editor" | "workspace";

const HIDDEN_CHAPTER_META_PATH = "chapters.meta.json";
const HIDDEN_SETTING_META_PATH = "settings.meta.json";
const DEFAULT_SETTING_CATEGORIES = ["人物", "势力", "地点", "世界观", "道具", "其他"];

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function getProjectEntryLabel(path: string) {
  if (path === "AGENTS.md") {
    return "代理规则 · AGENTS.md";
  }
  if (/outline/i.test(path) || /大纲/.test(path)) {
    return `故事大纲 · ${path}`;
  }
  return path;
}

function normalizeNumericId(value: string) {
  return value.replace(/\D+/g, "");
}

function normalizeVolumeId(value: string) {
  const digits = normalizeNumericId(value);
  return digits ? digits.padStart(3, "0") : "";
}

function normalizeSettingCategory(value: string) {
  return value.trim();
}

function sanitizeSettingJson(value: SettingJson): SettingJson {
  return {
    id: normalizeNumericId(value.id),
    name: value.name.trim(),
    content: value.content,
  };
}

function sanitizeChapterJson(value: ChapterJson): ChapterJson {
  return {
    id: normalizeNumericId(value.id),
    name: value.name.trim(),
    outline: value.outline,
    content: value.content,
  };
}

function buildChapterTargetLabel(chapter: ChapterJson | null, fallbackName: string | null) {
  const name = chapter?.name?.trim() || fallbackName?.trim() || "未命名章节";
  const id = chapter?.id?.trim() ?? "";
  return id ? `第 ${id} 章 · ${name}` : name;
}

function buildChapterEntryLabel(entryId: string | null | undefined, name: string) {
  const normalizedName = name.trim() || "未命名章节";
  const normalizedId = entryId?.trim() ?? "";
  return normalizedId ? `第 ${normalizedId} 章 · ${normalizedName}` : normalizedName;
}

function getChapterVolumeId(path: string) {
  return path.includes("/") ? normalizeVolumeId(path.split("/")[0] ?? "") : "001";
}

function getSettingCategory(path: string) {
  const category = path.includes("/") ? path.split("/")[0] ?? "" : "";
  return normalizeSettingCategory(category) || "其他";
}

function getSettingBaseName(path: string) {
  return path.includes("/") ? (path.split("/").at(-1) ?? path) : path;
}

function getSettingEntryId(path: string) {
  return getSettingBaseName(path).split("-")[0] ?? "";
}

function getSettingFallbackName(path: string) {
  const baseName = getSettingBaseName(path);
  const fallbackName = baseName.split("-").slice(1).join("-").trim();
  return fallbackName || baseName;
}

function parseChapterMeta(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { volumes?: unknown };
    if (!Array.isArray(parsed.volumes)) {
      return [];
    }
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

function parseSettingMeta(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { categories?: unknown };
    if (!Array.isArray(parsed.categories)) {
      return [];
    }
    return parsed.categories
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeSettingCategory(item))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildVolumeMetaContent(volumeIds: string[]) {
  return serializeJson({
    volumes: Array.from(new Set(volumeIds.map((item) => normalizeVolumeId(item)).filter(Boolean))).sort(),
  });
}

function sortSettingCategories(categories: string[]) {
  const unique = Array.from(new Set(categories.map((item) => normalizeSettingCategory(item)).filter(Boolean)));
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

function buildSettingMetaContent(categories: string[]) {
  return serializeJson({
    categories: sortSettingCategories([...DEFAULT_SETTING_CATEGORIES, ...categories]),
  });
}

function toChineseNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const raw = String(value);
  let result = "";

  for (let index = 0; index < raw.length; index += 1) {
    const digit = Number(raw[index]);
    const unitIndex = raw.length - index - 1;
    if (digit === 0) {
      if (result && !result.endsWith("零") && raw.slice(index + 1).split("").some((char) => char !== "0")) {
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

function formatVolumeLabel(volumeId: string) {
  const numeric = Number.parseInt(volumeId, 10);
  return Number.isFinite(numeric) && numeric > 0 ? `第${toChineseNumber(numeric)}卷` : `${volumeId}卷`;
}

function getNextVolumeId(volumeIds: string[]) {
  const maxValue = volumeIds.reduce((currentMax, volumeId) => {
    const numeric = Number.parseInt(volumeId, 10);
    return Number.isFinite(numeric) ? Math.max(currentMax, numeric) : currentMax;
  }, 0);
  return String(maxValue + 1).padStart(3, "0");
}

function DetailTitle({ name }: { name: string }) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
      <Link to={buildExpansionListRoute()} className="text-muted-foreground transition-colors hover:text-foreground">
        创作台
      </Link>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>{name}</span>
    </div>
  );
}

function EntryButton({
  active,
  canModify,
  label,
  onClick,
  onDelete,
  onRename,
}: {
  active: boolean;
  canModify: boolean;
  label: string;
  onClick: () => void;
  onDelete?: () => void;
  onRename?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center border-b border-border transition",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center px-3 py-2 text-left">
        <span className="block min-w-0 truncate text-sm font-medium">{label}</span>
      </button>
      {canModify ? (
        <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-hover:flex">
          {onRename ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="重命名"
              onClick={(event) => {
                event.stopPropagation();
                onRename();
              }}
              className="text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="删除"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({
  label,
  onAdd,
}: {
  label: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {onAdd ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-label={`新建${label}`}
              variant="ghost"
              size="icon-sm"
              onClick={onAdd}
              className="text-muted-foreground"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{`新建${label}`}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function BatchOutlineVolumeDialog({
  busy,
  onCancel,
  onChange,
  onConfirm,
  value,
  volumeIds,
}: {
  busy: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  value: string;
  volumeIds: string[];
}) {
  return (
    <DialogShell title="批量生成细纲" onClose={onCancel}>
      <div className="flex flex-1 flex-col gap-5">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">选择已有分卷</p>
          <div className="flex flex-wrap gap-2">
            {volumeIds.length > 0 ? (
              volumeIds.map((volumeId) => {
                const active = normalizeVolumeId(value) === volumeId;
                return (
                  <Button
                    key={volumeId}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => onChange(volumeId)}
                    className="h-9 gap-1.5"
                  >
                    <span>{formatVolumeLabel(volumeId)}</span>
                  </Button>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                当前还没有分卷，先点击左侧分卷区域右上角创建分卷。
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={busy || volumeIds.length === 0} onClick={onConfirm}>
            {busy ? "处理中..." : "开始生成"}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

export function ExpansionDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [detail, setDetail] = useState<ExpansionWorkspaceDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedKey>(null);
  const [rawContent, setRawContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [activeWorkspaceTask, setActiveWorkspaceTask] = useState<ExpansionWorkspaceTask | null>(null);
  const [workspaceAgentParts, setWorkspaceAgentParts] = useState<AgentPart[]>([]);
  const [workspaceExecutionPrompt, setWorkspaceExecutionPrompt] = useState("");
  const [workspaceRunStatus, setWorkspaceRunStatus] = useState<AgentRunStatus>("idle");
  const [volumeIds, setVolumeIds] = useState<string[]>([]);
  const [volumeExpanded, setVolumeExpanded] = useState<Record<string, boolean>>({});
  const [settingCategories, setSettingCategories] = useState<string[]>(DEFAULT_SETTING_CATEGORIES);
  const [settingExpanded, setSettingExpanded] = useState<Record<string, boolean>>({});
  const [createSettingCategory, setCreateSettingCategory] = useState<string | null>(null);
  const [createSettingName, setCreateSettingName] = useState("");
  const [createSettingBusy, setCreateSettingBusy] = useState(false);
  const [createVolumeBusy, setCreateVolumeBusy] = useState(false);
  const [batchOutlineVolumeOpen, setBatchOutlineVolumeOpen] = useState(false);
  const [batchOutlineVolumeValue, setBatchOutlineVolumeValue] = useState("");
  const [freeInputOpen, setFreeInputOpen] = useState(false);
  const [freeInputValue, setFreeInputValue] = useState("");
  const [createChapterVolumeId, setCreateChapterVolumeId] = useState<string | null>(null);
  const [createChapterName, setCreateChapterName] = useState("");
  const [createChapterBusy, setCreateChapterBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ section: "settings" | "chapters"; path: string; current: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ section: "settings" | "chapters"; path: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<MobileExpansionTab>("editor");

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    void loadDetail();
  }, [workspaceId]);

  useEffect(() => {
    setActiveWorkspaceTask(null);
    setWorkspaceAgentParts([]);
    setWorkspaceExecutionPrompt("");
    setWorkspaceRunStatus("idle");
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !detail) {
      return;
    }
    let cancelled = false;
    const derivedVolumeIds = detail.chapterEntries.map((entry) => getChapterVolumeId(entry.path));
    void readExpansionEntry(workspaceId, "project", HIDDEN_CHAPTER_META_PATH)
      .then((value) => {
        if (cancelled) {
          return;
        }
        setVolumeIds(Array.from(new Set([...parseChapterMeta(value), ...derivedVolumeIds])).sort());
      })
      .catch(() => {
        if (!cancelled) {
          setVolumeIds(Array.from(new Set(derivedVolumeIds)).sort());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !detail) {
      return;
    }
    let cancelled = false;
    const derivedCategories = detail.settingEntries.map((entry) => getSettingCategory(entry.path));
    void readExpansionEntry(workspaceId, "project", HIDDEN_SETTING_META_PATH)
      .then((value) => {
        if (cancelled) {
          return;
        }
        setSettingCategories(
          sortSettingCategories([...DEFAULT_SETTING_CATEGORIES, ...parseSettingMeta(value), ...derivedCategories]),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSettingCategories(sortSettingCategories([...DEFAULT_SETTING_CATEGORIES, ...derivedCategories]));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail, workspaceId]);

  async function loadDetail() {
    if (!workspaceId) {
      return;
    }
    setStatus("loading");
    try {
      const next = await getExpansionWorkspaceDetail(workspaceId);
      setDetail(next);
      setStatus("ready");
      setSelected((current) => {
        if (current) {
          return current;
        }
        const projectEntries = next.projectEntries.filter(
          (entry) => entry.path !== HIDDEN_CHAPTER_META_PATH && entry.path !== HIDDEN_SETTING_META_PATH,
        );
        const defaultEntry =
          projectEntries.find((entry) => entry.path === "AGENTS.md") ?? projectEntries[0] ?? null;
        return defaultEntry ? { section: "project", path: defaultEntry.path } : null;
      });
    } catch (error) {
      setErrorMessage(getReadableError(error));
      setStatus("error");
    }
  }

  async function refreshSelectedEntry(nextSelected = selected) {
    if (!workspaceId || !nextSelected) {
      return;
    }
    try {
      const value = await readExpansionEntry(workspaceId, nextSelected.section, nextSelected.path);
      setRawContent(value);
      setIsDirty(false);
    } catch {
      // 保留当前编辑内容
    }
  }

  useEffect(() => {
    if (!workspaceId || !selected) {
      setRawContent("");
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setIsDirty(false);
    void readExpansionEntry(workspaceId, selected.section, selected.path)
      .then((value) => {
        if (!cancelled) {
          setRawContent(value);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setToastState({ title: getReadableError(error), tone: "error" });
          setRawContent("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setContentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.path, selected?.section, workspaceId]);

  useEffect(() => {
    if (!isMobile || !selected) {
      return;
    }
    setMobileActiveTab("editor");
  }, [isMobile, selected?.path, selected?.section]);

  const selectedSettingEntry = useMemo(() => {
    if (!detail || selected?.section !== "settings") {
      return null;
    }
    return detail.settingEntries.find((entry) => entry.path === selected.path) ?? null;
  }, [detail, selected]);

  const selectedChapterEntry = useMemo(() => {
    if (!detail || selected?.section !== "chapters") {
      return null;
    }
    return detail.chapterEntries.find((entry) => entry.path === selected.path) ?? null;
  }, [detail, selected]);

  const parsedSetting = useMemo(() => {
    if (selected?.section !== "settings") {
      return null;
    }
    const fallbackId = selectedSettingEntry?.entryId ?? getSettingEntryId(selected.path);
    const fallbackName = selectedSettingEntry?.name ?? getSettingFallbackName(selected.path);
    return parseSettingJson(rawContent, fallbackId, fallbackName);
  }, [rawContent, selected, selectedSettingEntry]);

  const parsedChapter = useMemo(() => {
    if (selected?.section !== "chapters") {
      return null;
    }
    return parseChapterJson(rawContent, selectedChapterEntry?.entryId ?? "", selectedChapterEntry?.name ?? selected.path);
  }, [rawContent, selected, selectedChapterEntry]);

  const visibleProjectEntries = useMemo(
    () =>
      detail?.projectEntries.filter(
        (entry) => entry.path !== HIDDEN_CHAPTER_META_PATH && entry.path !== HIDDEN_SETTING_META_PATH,
      ) ?? [],
    [detail?.projectEntries],
  );

  const settingGroups = useMemo<SettingCategoryGroup[]>(() => {
    if (!detail) {
      return [];
    }
    const groups = new Map<string, ExpansionWorkspaceDetail["settingEntries"]>();
    for (const category of settingCategories) {
      groups.set(category, []);
    }
    for (const entry of detail.settingEntries) {
      const category = getSettingCategory(entry.path);
      const current = groups.get(category) ?? [];
      current.push(entry);
      groups.set(category, current);
    }
    return sortSettingCategories(Array.from(groups.keys())).map((category) => ({
      category,
      entries: groups.get(category) ?? [],
    }));
  }, [detail, settingCategories]);

  const chapterVolumes = useMemo<ChapterVolumeGroup[]>(() => {
    if (!detail) {
      return [];
    }
    const groups = new Map<string, ExpansionWorkspaceDetail["chapterEntries"]>();
    for (const volumeId of volumeIds) {
      groups.set(volumeId, []);
    }
    for (const entry of detail.chapterEntries) {
      const volumeId = getChapterVolumeId(entry.path);
      const current = groups.get(volumeId) ?? [];
      current.push(entry);
      groups.set(volumeId, current);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
      .map(([volumeId, entries]) => ({ volumeId, entries }));
  }, [detail, volumeIds]);

  useEffect(() => {
    if (chapterVolumes.length === 0) {
      return;
    }
    setVolumeExpanded((current) => {
      const next = { ...current };
      for (const group of chapterVolumes) {
        if (!(group.volumeId in next)) {
          next[group.volumeId] = true;
        }
      }
      return next;
    });
  }, [chapterVolumes]);

  useEffect(() => {
    if (settingGroups.length === 0) {
      return;
    }
    setSettingExpanded((current) => {
      const next = { ...current };
      for (const group of settingGroups) {
        if (!(group.category in next)) {
          next[group.category] = true;
        }
      }
      return next;
    });
  }, [settingGroups]);

  const currentFilePath = selected ? `${selected.section}/${selected.path}` : null;

  const currentFileName = useMemo(() => {
    if (!selected) {
      return null;
    }
    if (selected.section === "project") {
      return selected.path;
    }
    if (selected.section === "settings") {
      return parsedSetting?.name ?? selectedSettingEntry?.name ?? selected.path;
    }
    return parsedChapter?.name ?? selectedChapterEntry?.name ?? selected.path;
  }, [parsedChapter?.name, parsedSetting?.name, selected, selectedChapterEntry?.name, selectedSettingEntry?.name]);

  const currentSelectionLabel = useMemo(() => {
    if (!selected) {
      return null;
    }
    if (selected.section === "project") {
      return selected.path;
    }
    if (selected.section === "settings") {
      return parsedSetting?.name ?? selectedSettingEntry?.name ?? "设定";
    }
    return buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null);
  }, [parsedChapter, parsedSetting?.name, selected, selectedChapterEntry?.name, selectedSettingEntry?.name]);

  const workspaceStatusButton = useMemo(() => {
    if (workspaceRunStatus === "running") {
      return {
        className: "text-amber-700",
        icon: LoaderCircle,
        iconClassName: "animate-spin",
        label: activeWorkspaceTask ? `${activeWorkspaceTask.actionLabel} · 运行中` : "运行中",
      };
    }
    if (workspaceRunStatus === "failed") {
      return {
        className: "text-destructive",
        icon: AlertCircle,
        iconClassName: "",
        label: activeWorkspaceTask ? `${activeWorkspaceTask.actionLabel} · 失败` : "失败",
      };
    }
    if (activeWorkspaceTask) {
      return {
        className: "text-emerald-700",
        icon: CheckCircle2,
        iconClassName: "",
        label: `${activeWorkspaceTask.actionLabel} · ${activeWorkspaceTask.statusLabel}`,
      };
    }
    return {
      className: "text-muted-foreground",
      icon: CheckCircle2,
      iconClassName: "",
      label: "空闲",
    };
  }, [activeWorkspaceTask, workspaceRunStatus]);
  const WorkspaceStatusIcon = workspaceStatusButton.icon;

  function applySetting(next: SettingJson) {
    setRawContent(serializeJson(sanitizeSettingJson(next)));
    setIsDirty(true);
  }

  function applyChapter(next: ChapterJson) {
    setRawContent(serializeJson(sanitizeChapterJson(next)));
    setIsDirty(true);
  }

  async function saveVolumeMeta(nextVolumeIds: string[]) {
    if (!workspaceId) {
      return;
    }
    await writeExpansionEntry(
      workspaceId,
      "project",
      HIDDEN_CHAPTER_META_PATH,
      buildVolumeMetaContent(nextVolumeIds),
    );
  }

  async function saveSettingMeta(nextCategories: string[]) {
    if (!workspaceId) {
      return;
    }
    await writeExpansionEntry(
      workspaceId,
      "project",
      HIDDEN_SETTING_META_PATH,
      buildSettingMetaContent(nextCategories),
    );
  }

  async function runWorkspaceAgentAction(params: {
    actionId: ExpansionWorkspaceActionId;
    actionLabel: string;
    description: string;
    prompt: string;
    targetLabel: string;
  }) {
    if (!workspaceId || !detail) {
      return;
    }

    setActiveWorkspaceTask({
      actionId: params.actionId,
      actionLabel: params.actionLabel,
      createdAt: Date.now(),
      description: params.description,
      statusLabel: "运行中",
      targetLabel: params.targetLabel,
    });
    setWorkspaceAgentParts([]);
    setWorkspaceExecutionPrompt(params.prompt);
    setWorkspaceRunStatus("running");

    try {
      const agentSettings = useAgentSettingsStore.getState();
      if (agentSettings.status !== "ready") {
        await agentSettings.initialize();
      }
      const skillsStore = useSkillsStore.getState();
      if (skillsStore.status === "idle") {
        await skillsStore.initialize();
      }
      const agentStore = useSubAgentStore.getState();
      if (agentStore.status === "idle") {
        await agentStore.initialize();
      }

      const providerConfig = useAgentSettingsStore.getState().config;
      const defaultAgentMarkdown = useAgentSettingsStore.getState().defaultAgentMarkdown;
      const enabledSkills = getEnabledSkills(useSkillsStore.getState());
      const enabledAgents = getEnabledAgents(useSubAgentStore.getState());
      const projectFiles = await Promise.all(
        visibleProjectEntries.map(async (entry) => ({
          content: await readExpansionEntry(workspaceId, "project", entry.path),
          name: entry.path,
          path: `project/${entry.path}`,
        })),
      );

      const stream = runAgentTurn({
        activeFilePath: currentFilePath,
        conversationHistory: [],
        defaultAgentMarkdown,
        enabledAgents,
        enabledSkills,
        enabledToolIds: [
          "todo",
          "task",
          "browse",
          "search",
          "read",
          "write",
          "path",
          "skill",
          "agent",
          "web_search",
          "web_fetch",
          "expansion_chapter_batch_outline",
          "expansion_chapter_write_content",
          "expansion_setting_batch_generate",
          "expansion_setting_update_from_chapter",
          "expansion_continuity_scan",
        ],
        mode: "expansion",
        modeContext: {
          actionId: params.actionId,
          actionLabel: params.actionLabel,
        },
        manualContext: null,
        planningState: { items: [], roundsSinceUpdate: 0 },
        projectContext: {
          source: "创作台默认上下文",
          files: projectFiles,
        },
        prompt: params.prompt,
        providerConfig,
        workspaceRootPath: `expansion://${workspaceId}`,
        workspaceTools: {
          ...createGlobalToolset(),
          ...createLocalResourceToolset({
            refreshAgents: async () => {
              await useSubAgentStore.getState().refresh();
            },
            refreshSkills: async () => {
              await useSkillsStore.getState().refresh();
            },
          }),
          ...createExpansionAgentToolset({
            workspaceId,
            onWorkspaceMutated: async () => {
              await loadDetail();
              await refreshSelectedEntry();
            },
          }),
          ...createExpansionSemanticToolset({
            workspaceId,
            onWorkspaceMutated: async () => {
              await loadDetail();
              await refreshSelectedEntry();
            },
          }),
        },
      });

      let nextParts: AgentPart[] = [];
      for await (const part of stream) {
        nextParts = mergePart(nextParts, part as AgentPart);
        setWorkspaceAgentParts(nextParts);
      }

      setWorkspaceRunStatus("completed");
      setActiveWorkspaceTask((current) =>
        current
          ? {
              ...current,
              statusLabel: "已完成",
            }
          : current,
      );
      await loadDetail();
      await refreshSelectedEntry();
    } catch (error) {
      setWorkspaceRunStatus("failed");
      setWorkspaceAgentParts((current) => [
        ...current,
        {
          type: "text",
          text: error instanceof Error ? error.message : "创作台 Agent 执行失败。",
        },
      ]);
      setActiveWorkspaceTask((current) =>
        current
          ? {
              ...current,
              statusLabel: "失败",
            }
          : current,
      );
      setToastState({
        title: error instanceof Error ? error.message : "创作台 Agent 执行失败。",
        tone: "error",
      });
    }
  }

  function requireActionTarget(targetLabel: string | null, errorTitle: string) {
    if (targetLabel) {
      return targetLabel;
    }
    setToastState({ title: errorTitle, tone: "error" });
    return null;
  }

  function openBatchOutlineDialog() {
    setBatchOutlineVolumeValue(volumeIds[0] ?? "001");
    setBatchOutlineVolumeOpen(true);
  }

  async function handleWorkspaceBatchOutline() {
    const targetLabel = requireActionTarget(currentSelectionLabel, "请先打开一个项目文件");
    if (!targetLabel) {
      return;
    }
    const targetVolumeId = normalizeVolumeId(batchOutlineVolumeValue || volumeIds[0] || "001");
    const nextVolumeIds = Array.from(new Set([...volumeIds, targetVolumeId])).sort();
    if (workspaceId && !volumeIds.includes(targetVolumeId)) {
      await saveVolumeMeta(nextVolumeIds);
      setVolumeIds(nextVolumeIds);
      setVolumeExpanded((current) => ({ ...current, [targetVolumeId]: true }));
    }
    setBatchOutlineVolumeOpen(false);
    void runWorkspaceAgentAction({
      actionId: "project-batch-outline",
      actionLabel: "批量生成细纲",
      description: "根据大纲批量创建章节 JSON，并写入章节名与约 300 字细纲。",
      prompt: [
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath ?? "project/outline.md"}`,
        `目标分卷：${targetVolumeId}（${formatVolumeLabel(targetVolumeId)}）`,
        "先用 skill 工具读取技能：chapter-planner、outline-manager。",
        `调用 expansion_chapter_batch_outline 时必须传 volumeId=${targetVolumeId}。`,
        "章节数量按全书规模与本卷定位自行推断；新章节 ID 不得与现有冲突，不确定时先用 expansion_continuity_scan 校验。",
        "outline 约 300 字，必须包含：本章主爽点（升级/打脸/收编/扮猪吃虎等）、核心冲突、关键转折、章末钩子（悬念/战斗/反转/情绪）。",
        "卷内节奏：起始章定调，中段递进，卷末高潮。单章 1 个核心冲突 + 1-2 个推进点，避免灌水。",
      ].join("\n"),
      targetLabel,
    });
  }

  function handleWorkspaceBatchSettings() {
    const targetLabel = requireActionTarget(currentSelectionLabel, "请先打开一个项目文件");
    if (!targetLabel) {
      return;
    }
    void runWorkspaceAgentAction({
      actionId: "project-batch-settings",
      actionLabel: "批量生成设定",
      description: "根据大纲和 AGENTS 相关内容批量生成设定 JSON。",
      prompt: [
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath ?? "project/AGENTS.md"}`,
        "先用 skill 工具读取技能：story-bible、plot-planner。",
        "覆盖类别按需选择：人物 / 地点 / 势力 / 世界观 / 道具；主角与重要配角必须包含。",
        "主角设定必含：金手指、性格主标签、行事原则、社交模式。",
        "反派/对手设定必含：威胁层级、与主角差距、击败条件。",
        "世界观设定必含：力量体系等阶、升级路径、顶端是什么。",
        "阵营/势力设定必含：与主角关系、资源池、立场。",
        "用 expansion_setting_batch_generate 批量写回，不要走通用 write。",
      ].join("\n"),
      targetLabel,
    });
  }

  function handleWorkspaceSettingUpdate() {
    const targetLabel = requireActionTarget(parsedSetting?.name ?? selectedSettingEntry?.name ?? null, "请先打开一个设定文件");
    if (!targetLabel) {
      return;
    }
    void runWorkspaceAgentAction({
      actionId: "setting-update",
      actionLabel: "更新设定",
      description: "根据最新章节梗概、正文和全书大纲更新当前设定。",
      prompt: [
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath}`,
        "先用 skill 工具读取技能：story-state、story-bible。",
        "先读取当前设定 JSON，再读取最新章节正文、章节细纲与 project/outline.md。",
        "仅更新与最新剧情冲突或新增的部分，未变动内容保持原文。",
        "人物状态变化必标：等级 / 实力数值 / 资源 / 关系网；用「第X章：xxx」格式追加到 content 末尾，保留历史轨迹。",
        "区分「读者已知」与「读者未知」（POV 信息差），未揭示信息标注隐藏度。",
        "如剧情产生新设定，用 expansion_setting_batch_generate 创建。",
      ].join("\n"),
      targetLabel,
    });
  }

  function handleWorkspaceChapterWrite() {
    const targetLabel = requireActionTarget(buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null), "请先打开一个章节");
    if (!targetLabel) {
      return;
    }
    const currentOutline = parsedChapter?.outline?.trim() || "（当前章节细纲为空）";
    void runWorkspaceAgentAction({
      actionId: "chapter-write",
      actionLabel: "章节写作",
      description: "根据本章细纲、相关设定和前后文章写本章正文。",
      prompt: [
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath}`,
        "当前章节细纲：",
        currentOutline,
        "先用 skill 工具读取技能：story-writer、humanizer、continuity-check。",
        "按需读取相关设定文件、前后章节的细纲与正文，保证人物状态、视角、时态、时间线连续。",
        "字数目标 2000-3000 字（如 .project/AGENTS.md 另有约定以其为准）。",
        "开篇 200 字内必须有具体场景或冲突，不要环境描写堆砌。",
        "对话占比 ≥ 30%，避免大段心理描写或旁白；严格保持人称视角，不中途漂移。",
        "每 500 字至少一个推进点（信息释放 / 情绪转折 / 冲突升级 / 实力变化）。",
        "严格按本章 outline 推进，不擅自加超纲剧情；本章必须落地一个主爽点。",
        "章末必须留钩子（悬念/战斗/反转/情绪任选），禁止平淡收束。",
        "落稿后按 humanizer 规则消除 AI 味；写回 content，可按需同步补充 outline。",
      ].join("\n"),
      targetLabel,
    });
  }

  function handleWorkspaceChapterSettingUpdate() {
    const targetLabel = requireActionTarget(buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null), "请先打开一个章节");
    if (!targetLabel) {
      return;
    }
    void runWorkspaceAgentAction({
      actionId: "chapter-setting-update",
      actionLabel: "设定更新",
      description: "分析本章正文涉及的内容，更新相关设定并补充新增设定。",
      prompt: [
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath}`,
        "先用 skill 工具读取技能：story-state、continuity-check。",
        "先读取当前章节 JSON 的 outline 与 content，分析涉及的人物、地点、物品、势力、概念和关系变化。",
        "必须更新主角的等级 / 实力数值 / 资源 / 关系网变化；用「第X章：xxx」格式追加到对应设定 content 末尾。",
        "区分「显性事件」与「暗线伏笔」，伏笔标注隐藏度（已揭示 / 部分揭示 / 未揭示）。",
        "新出场实体（NPC / 物品 / 势力）必须用 expansion_setting_batch_generate 创建独立 settings JSON。",
        "与既有设定冲突时以正文为准，反向修订设定。",
      ].join("\n"),
      targetLabel,
    });
  }

  function openWorkspaceFreeInputDialog() {
    setFreeInputValue("");
    setFreeInputOpen(true);
  }

  function handleWorkspaceFreeInput() {
    const userPrompt = freeInputValue.trim();
    if (!userPrompt) {
      setToastState({ title: "请输入要发给 AI 的提示词", tone: "error" });
      return;
    }
    const targetLabel = currentSelectionLabel ?? currentFileName ?? detail?.name ?? "当前工作区";
    setFreeInputOpen(false);
    setFreeInputValue("");
    void runWorkspaceAgentAction({
      actionId: "free-input",
      actionLabel: "自由输入",
      description: "根据自定义提示词在当前工作区内执行 AI 操作。",
      prompt: [
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath ?? "未限定，按当前工作区处理"}`,
        "用户输入提示词：",
        userPrompt,
        "如用户未限定输出形态，先判断是写回文件还是仅给建议；涉及创作时按 skill 工具读取相关技能再执行。",
      ].join("\n"),
      targetLabel,
    });
  }

  function handleClearWorkspaceLogs() {
    setActiveWorkspaceTask(null);
    setWorkspaceAgentParts([]);
    setWorkspaceExecutionPrompt("");
    setWorkspaceRunStatus("idle");
  }

  const contextualWorkspaceActions: ExpansionWorkspaceActionButton[] =
    selected?.section === "project"
      ? [
          {
            description: "",
            id: "project-batch-outline",
            label: "批量生成细纲",
            onClick: openBatchOutlineDialog,
          },
          {
            description: "",
            id: "project-batch-settings",
            label: "批量生成设定",
            onClick: handleWorkspaceBatchSettings,
          },
        ]
      : selected?.section === "settings"
        ? [
            {
              description: "",
              id: "setting-update",
              label: "更新设定",
              onClick: handleWorkspaceSettingUpdate,
            },
          ]
        : selected?.section === "chapters"
          ? [
              {
                description: "",
                id: "chapter-write",
                label: "章节写作",
                onClick: handleWorkspaceChapterWrite,
              },
              {
                description: "",
                id: "chapter-setting-update",
                label: "设定更新",
                onClick: handleWorkspaceChapterSettingUpdate,
              },
            ]
          : [];
  const availableWorkspaceActions: ExpansionWorkspaceActionButton[] = [
    ...contextualWorkspaceActions,
    {
      description: "",
      id: "free-input",
      label: "自由输入",
      onClick: openWorkspaceFreeInputDialog,
    },
  ];

  async function handleSave() {
    if (!workspaceId || !selected || !isDirty || saveBusy) {
      return;
    }
    setSaveBusy(true);
    try {
      let nextSelected = selected;
      let nextContent = rawContent;

      if (selected.section === "settings" && parsedSetting && detail) {
        const sanitized = sanitizeSettingJson(parsedSetting);
        const currentEntry = detail.settingEntries.find((entry) => entry.path === selected.path);
        if (currentEntry && sanitized.name && sanitized.name !== currentEntry.name) {
          const renamed = await renameExpansionEntry(workspaceId, "settings", selected.path, sanitized.name);
          nextSelected = { section: renamed.section, path: renamed.path };
          setSelected(nextSelected);
        }
        nextContent = serializeJson(sanitized);
      }

      if (selected.section === "chapters" && parsedChapter && detail) {
        const sanitized = sanitizeChapterJson(parsedChapter);
        const currentEntry = detail.chapterEntries.find((entry) => entry.path === selected.path);
        if (currentEntry && sanitized.name && sanitized.name !== currentEntry.name) {
          const renamed = await renameExpansionEntry(workspaceId, "chapters", selected.path, sanitized.name);
          nextSelected = { section: renamed.section, path: renamed.path };
          setSelected(nextSelected);
        }
        nextContent = serializeJson(sanitized);
      }

      await writeExpansionEntry(workspaceId, nextSelected.section, nextSelected.path, nextContent);
      setRawContent(nextContent);
      setIsDirty(false);
      setToastState({ title: "已保存", tone: "success" });
      await loadDetail();
      await refreshSelectedEntry(nextSelected);
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleCreateSetting() {
    if (!workspaceId || !createSettingCategory || createSettingBusy) {
      return;
    }
    const name = createSettingName.trim();
    if (!name) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setCreateSettingBusy(true);
    try {
      const nextCategories = sortSettingCategories([...settingCategories, createSettingCategory]);
      await saveSettingMeta(nextCategories);
      const created = await createExpansionEntry(workspaceId, "settings", name, createSettingCategory);
      setSettingCategories(nextCategories);
      setCreateSettingCategory(null);
      setCreateSettingName("");
      await loadDetail();
      setSelected({ section: created.section, path: created.path });
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setCreateSettingBusy(false);
    }
  }

  async function handleCreateVolume() {
    if (!workspaceId || createVolumeBusy) {
      return;
    }
    const nextVolumeId = getNextVolumeId(volumeIds);
    setCreateVolumeBusy(true);
    try {
      const nextVolumeIds = Array.from(new Set([...volumeIds, nextVolumeId])).sort();
      await saveVolumeMeta(nextVolumeIds);
      setVolumeIds(nextVolumeIds);
      setVolumeExpanded((current) => ({ ...current, [nextVolumeId]: true }));
      setToastState({ title: `已创建 ${formatVolumeLabel(nextVolumeId)}`, tone: "success" });
      await loadDetail();
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setCreateVolumeBusy(false);
    }
  }

  async function handleCreateChapter() {
    if (!workspaceId || !createChapterVolumeId || createChapterBusy) {
      return;
    }
    const name = createChapterName.trim();
    if (!name) {
      setToastState({ title: "章节名称不能为空", tone: "error" });
      return;
    }
    setCreateChapterBusy(true);
    try {
      const volumeId = normalizeVolumeId(createChapterVolumeId);
      const nextVolumeIds = Array.from(new Set([...volumeIds, volumeId])).sort();
      await saveVolumeMeta(nextVolumeIds);
      const created = await createExpansionEntry(workspaceId, "chapters", name, volumeId);
      setVolumeIds(nextVolumeIds);
      setVolumeExpanded((current) => ({ ...current, [volumeId]: true }));
      setCreateChapterVolumeId(null);
      setCreateChapterName("");
      await loadDetail();
      setSelected({ section: created.section, path: created.path });
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setCreateChapterBusy(false);
    }
  }

  async function handleRename() {
    if (!workspaceId || !renameTarget || renameBusy) {
      return;
    }
    const nextName = renameValue.trim();
    if (!nextName) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setRenameBusy(true);
    try {
      const updated = await renameExpansionEntry(workspaceId, renameTarget.section, renameTarget.path, nextName);
      setRenameTarget(null);
      setRenameValue("");
      await loadDetail();
      setSelected({ section: updated.section, path: updated.path });
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDeleteEntry() {
    if (!workspaceId || !deleteTarget || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteExpansionEntry(workspaceId, deleteTarget.section, deleteTarget.path);
      const wasSelected = selected?.section === deleteTarget.section && selected.path === deleteTarget.path;
      setDeleteTarget(null);
      await loadDetail();
      if (wasSelected) {
        setSelected({ section: "project", path: "AGENTS.md" });
      }
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setDeleteBusy(false);
    }
  }

  function renderContextColumn() {
    return (
      <aside className="flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-border bg-app lg:w-[260px] lg:border-r lg:border-b-0">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SectionHeader label="上下文" />
          <div>
            {visibleProjectEntries.map((entry) => (
              <EntryButton
                key={`project-${entry.path}`}
                active={selected?.section === "project" && selected.path === entry.path}
                canModify={false}
                label={getProjectEntryLabel(entry.path)}
                onClick={() => setSelected({ section: "project", path: entry.path })}
              />
            ))}
          </div>

          <SectionHeader label="设定" />
          <div>
            {settingGroups.map((group) => {
              const isExpanded = settingExpanded[group.category] ?? true;
              return (
                <div key={`setting-category-${group.category}`} className="border-b border-border">
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={isExpanded ? `收起${group.category}` : `展开${group.category}`}
                      onClick={() =>
                        setSettingExpanded((current) => ({
                          ...current,
                          [group.category]: !isExpanded,
                        }))
                      }
                      className="text-muted-foreground"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{group.category}</div>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`在${group.category}内新建设定`}
                      onClick={() => {
                        setCreateSettingCategory(group.category);
                        setCreateSettingName("");
                      }}
                      className="text-muted-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {isExpanded ? (
                    <div>
                      {group.entries.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">当前分类暂无设定。</div>
                      ) : (
                        group.entries.map((entry) => (
                          <EntryButton
                            key={`setting-${entry.path}`}
                            active={selected?.section === "settings" && selected.path === entry.path}
                            canModify
                            label={entry.name}
                            onClick={() => setSelected({ section: "settings", path: entry.path })}
                            onDelete={() => setDeleteTarget({ section: "settings", path: entry.path, name: entry.name })}
                            onRename={() => {
                              setRenameTarget({ section: "settings", path: entry.path, current: entry.name });
                              setRenameValue(entry.name);
                            }}
                          />
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <SectionHeader
            label="正文分卷"
            onAdd={() => {
              void handleCreateVolume();
            }}
          />
          <div>
            {chapterVolumes.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">暂无分卷，点击右上角 + 新建。</div>
            ) : (
              chapterVolumes.map((group) => {
                const isExpanded = volumeExpanded[group.volumeId] ?? true;
                return (
                  <div key={`volume-${group.volumeId}`} className="border-b border-border">
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={isExpanded ? `收起${formatVolumeLabel(group.volumeId)}` : `展开${formatVolumeLabel(group.volumeId)}`}
                        onClick={() =>
                          setVolumeExpanded((current) => ({
                            ...current,
                            [group.volumeId]: !isExpanded,
                          }))
                        }
                        className="text-muted-foreground"
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{formatVolumeLabel(group.volumeId)}</div>
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`在${formatVolumeLabel(group.volumeId)}内新建章节`}
                        onClick={() => {
                          setCreateChapterVolumeId(group.volumeId);
                          setCreateChapterName("");
                        }}
                        className="text-muted-foreground"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {isExpanded ? (
                      <div>
                        {group.entries.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">当前分卷暂无章节。</div>
                        ) : (
                          group.entries.map((entry) => (
                            <EntryButton
                              key={`chapter-${entry.path}`}
                              active={selected?.section === "chapters" && selected.path === entry.path}
                              canModify
                              label={buildChapterEntryLabel(entry.entryId, entry.name)}
                              onClick={() => setSelected({ section: "chapters", path: entry.path })}
                              onDelete={() => setDeleteTarget({ section: "chapters", path: entry.path, name: entry.name })}
                              onRename={() => {
                                setRenameTarget({ section: "chapters", path: entry.path, current: entry.name });
                                setRenameValue(entry.name);
                              }}
                            />
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    );
  }

  function renderEditorColumn() {
    return (
      <section
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col bg-panel-subtle",
          isMobile ? "h-full overflow-y-auto" : "overflow-hidden",
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1">
          <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
            {currentSelectionLabel ?? "未选择"}
          </h2>
          <div className="flex items-center gap-1.5">
            {isDirty ? <span className="editor-status-chip" data-tone="warning">未保存</span> : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  aria-label={saveBusy ? "保存中" : "保存"}
                  variant="ghost"
                  size="icon-sm"
                  disabled={saveBusy || !isDirty}
                  onClick={() => void handleSave()}
                  className="text-muted-foreground"
                >
                  <Save className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>保存</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className={cn("min-h-0 flex-1", isMobile ? "overflow-visible" : "overflow-hidden")}>
          {!selected ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              从左侧选择一个条目开始编辑。
            </div>
          ) : contentLoading ? (
            <div className="flex h-full items-center px-3 py-2 text-sm text-muted-foreground">正在读取内容…</div>
          ) : selected.section === "project" ? (
            <ProjectEditor
              value={rawContent}
              onChange={(next) => {
                setRawContent(next);
                setIsDirty(true);
              }}
              fitContainer={!isMobile}
              disabled={saveBusy}
            />
          ) : selected.section === "settings" && parsedSetting ? (
            <SettingEditor value={parsedSetting} onChange={applySetting} disabled={saveBusy} fitContainer={!isMobile} />
          ) : selected.section === "chapters" && parsedChapter ? (
            <ChapterEditor value={parsedChapter} onChange={applyChapter} disabled={saveBusy} fitContainer={!isMobile} />
          ) : null}
        </div>
      </section>
    );
  }

  function renderWorkspaceColumn() {
    return (
      <div className={cn("min-h-0", isMobile && "h-full overflow-y-auto")}>
        <ExpansionWorkspacePanel
          activeTask={activeWorkspaceTask}
          agentParts={workspaceAgentParts}
          availableActions={availableWorkspaceActions}
          currentFileName={currentFileName}
          executionPrompt={workspaceExecutionPrompt}
          isMobile={isMobile}
          onClearLogs={handleClearWorkspaceLogs}
          runStatus={workspaceRunStatus}
          targetLabel={currentSelectionLabel}
        />
      </div>
    );
  }

  function renderMobileWorkspace() {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileActiveTab === "context"
            ? renderContextColumn()
            : mobileActiveTab === "workspace"
              ? renderWorkspaceColumn()
              : renderEditorColumn()}
        </div>

        <nav
          aria-label="创作台导航"
          className="shrink-0 border-t border-border bg-sidebar/95 px-2 backdrop-blur"
        >
          <div className="grid h-16 w-full grid-cols-3 gap-1">
            {[
              { tab: "context" as const, label: "上下文", Icon: FolderTree },
              { tab: "editor" as const, label: "编辑", Icon: SquarePen },
              { tab: "workspace" as const, label: "操作", Icon: Bot },
            ].map(({ tab, label, Icon }) => (
              <button
                key={tab}
                type="button"
                aria-label={label}
                onClick={() => setMobileActiveTab(tab)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition-colors duration-150",
                  mobileActiveTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={2.1} />
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <PageShell title={<DetailTitle name="加载中" />}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载创作项目...</div>
      </PageShell>
    );
  }

  if (status === "error" || !detail) {
    return (
      <PageShell title={<DetailTitle name="未找到" />}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <div className="space-y-3 text-center">
            <h2 className="text-base font-semibold text-foreground">未找到该创作项目</h2>
            <p>{errorMessage ?? "请返回列表重试。"}</p>
            <Button type="button" variant="outline" onClick={() => navigate(buildExpansionListRoute())}>
              返回创作台
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        title={<DetailTitle name={detail.name} />}
        contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("pointer-events-none gap-2", workspaceStatusButton.className)}
            >
              <WorkspaceStatusIcon className={cn("h-4 w-4", workspaceStatusButton.iconClassName)} />
              {workspaceStatusButton.label}
            </Button>
          </div>
        }
      >
        {isMobile ? (
          renderMobileWorkspace()
        ) : (
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            {renderContextColumn()}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
              {renderEditorColumn()}
              {renderWorkspaceColumn()}
            </div>
          </div>
        )}
      </PageShell>

      {createSettingCategory ? (
        <PromptDialog
          busy={createSettingBusy}
          confirmLabel="创建"
          description={`在 ${createSettingCategory} 内新建设定，id 会按当前顺序自动分配纯数字。`}
          label="设定名称"
          title="新建设定"
          value={createSettingName}
          onCancel={() => {
            if (!createSettingBusy) {
              setCreateSettingCategory(null);
            }
          }}
          onChange={setCreateSettingName}
          onConfirm={() => void handleCreateSetting()}
        />
      ) : null}

      {batchOutlineVolumeOpen ? (
        <BatchOutlineVolumeDialog
          busy={workspaceRunStatus === "running"}
          volumeIds={volumeIds}
          value={batchOutlineVolumeValue}
          onCancel={() => {
            if (workspaceRunStatus !== "running") {
              setBatchOutlineVolumeOpen(false);
            }
          }}
          onChange={setBatchOutlineVolumeValue}
          onConfirm={() => void handleWorkspaceBatchOutline()}
        />
      ) : null}

      {freeInputOpen ? (
        <DialogShell title="自由输入" onClose={() => {
          if (workspaceRunStatus !== "running") {
            setFreeInputOpen(false);
          }
        }}>
          <div className="flex flex-1 flex-col justify-between gap-5">
            <div className="space-y-2">
              <Label htmlFor="expansion-free-input" className="text-xs text-muted-foreground">
                提示词
              </Label>
              <Textarea
                id="expansion-free-input"
                autoFocus
                value={freeInputValue}
                onChange={(event) => setFreeInputValue(event.target.value)}
                placeholder="输入要发送给 AI 的自由提示词。"
                className="min-h-32 resize-y"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={workspaceRunStatus === "running"}
                onClick={() => setFreeInputOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={workspaceRunStatus === "running"}
                onClick={handleWorkspaceFreeInput}
              >
                发送给 AI
              </Button>
            </div>
          </div>
        </DialogShell>
      ) : null}

      {createChapterVolumeId ? (
        <PromptDialog
          busy={createChapterBusy}
          confirmLabel="创建"
          description={`在 ${formatVolumeLabel(createChapterVolumeId)} 内新建章节，文件会写入 chapters/${createChapterVolumeId}/。`}
          label="章节名称"
          title="新建章节"
          value={createChapterName}
          onCancel={() => {
            if (!createChapterBusy) {
              setCreateChapterVolumeId(null);
            }
          }}
          onChange={setCreateChapterName}
          onConfirm={() => void handleCreateChapter()}
        />
      ) : null}

      {renameTarget ? (
        <PromptDialog
          busy={renameBusy}
          confirmLabel="重命名"
          description="仅修改名称，id 保持不变。"
          label="新名称"
          title="重命名"
          value={renameValue}
          onCancel={() => {
            if (!renameBusy) {
              setRenameTarget(null);
            }
          }}
          onChange={setRenameValue}
          onConfirm={() => void handleRename()}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={deleteBusy}
          confirmLabel="删除"
          description={`将《${deleteTarget.name}》及其 JSON 数据永久删除。`}
          onCancel={() => {
            if (!deleteBusy) {
              setDeleteTarget(null);
            }
          }}
          onConfirm={() => void handleDeleteEntry()}
          title="删除条目"
        />
      ) : null}

      <Toast
        description={toastState?.description}
        open={toastState !== null}
        title={toastState?.title ?? ""}
        tone={toastState?.tone ?? "info"}
        onClose={() => setToastState(null)}
      />
    </>
  );
}
