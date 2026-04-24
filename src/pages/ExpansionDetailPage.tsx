import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
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
  deleteExpansionWorkspace,
  exportExpansionZip,
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

const HIDDEN_CHAPTER_META_PATH = "chapters.meta.json";

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

function normalizeLinkedIds(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((item) => normalizeNumericId(item.trim()))
        .filter(Boolean),
    ),
  );
}

function sanitizeSettingJson(value: SettingJson): SettingJson {
  return {
    id: normalizeNumericId(value.id),
    name: value.name.trim(),
    content: value.content,
    notes: value.notes,
    linkedChapterIds: normalizeLinkedIds(value.linkedChapterIds),
  };
}

function sanitizeChapterJson(value: ChapterJson): ChapterJson {
  return {
    id: normalizeNumericId(value.id),
    name: value.name.trim(),
    outline: value.outline,
    content: value.content,
    notes: value.notes,
    linkedSettingIds: normalizeLinkedIds(value.linkedSettingIds),
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

function buildVolumeMetaContent(volumeIds: string[]) {
  return serializeJson({
    volumes: Array.from(new Set(volumeIds.map((item) => normalizeVolumeId(item)).filter(Boolean))).sort(),
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
        扩写工坊
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
  const [createSettingOpen, setCreateSettingOpen] = useState(false);
  const [createSettingName, setCreateSettingName] = useState("");
  const [createSettingBusy, setCreateSettingBusy] = useState(false);
  const [createVolumeBusy, setCreateVolumeBusy] = useState(false);
  const [batchOutlineVolumeOpen, setBatchOutlineVolumeOpen] = useState(false);
  const [batchOutlineVolumeValue, setBatchOutlineVolumeValue] = useState("");
  const [createChapterVolumeId, setCreateChapterVolumeId] = useState<string | null>(null);
  const [createChapterName, setCreateChapterName] = useState("");
  const [createChapterBusy, setCreateChapterBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ section: "settings" | "chapters"; path: string; current: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ section: "settings" | "chapters"; path: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteWorkspaceOpen, setDeleteWorkspaceOpen] = useState(false);
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false);

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
        const projectEntries = next.projectEntries.filter((entry) => entry.path !== HIDDEN_CHAPTER_META_PATH);
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
    const fallbackId = selectedSettingEntry?.entryId ?? selected.path.split("-")[0] ?? "";
    const fallbackName =
      selectedSettingEntry?.name ?? (selected.path.split("-").slice(1).join("-") || selected.path);
    return parseSettingJson(rawContent, fallbackId, fallbackName);
  }, [rawContent, selected, selectedSettingEntry]);

  const parsedChapter = useMemo(() => {
    if (selected?.section !== "chapters") {
      return null;
    }
    return parseChapterJson(rawContent, selectedChapterEntry?.entryId ?? "", selectedChapterEntry?.name ?? selected.path);
  }, [rawContent, selected, selectedChapterEntry]);

  const visibleProjectEntries = useMemo(
    () => detail?.projectEntries.filter((entry) => entry.path !== HIDDEN_CHAPTER_META_PATH) ?? [],
    [detail?.projectEntries],
  );

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
        manualContext: null,
        planningState: { items: [], roundsSinceUpdate: 0 },
        projectContext: {
          source: "扩写项目默认上下文",
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
          text: error instanceof Error ? error.message : "扩写 Agent 执行失败。",
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
        title: error instanceof Error ? error.message : "扩写 Agent 执行失败。",
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
        "当前动作：批量生成细纲",
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath ?? "project/outline.md"}`,
        `目标分卷：${targetVolumeId}（${formatVolumeLabel(targetVolumeId)}）`,
        "要求：",
        "- 必须先读取 project/AGENTS.md 和 project/outline.md。",
        "- 通过 expansion_chapter_batch_outline 工具批量创建 chapters 区域 JSON。",
        `- 所有新章节默认写入 ${targetVolumeId} 分卷；调用工具时必须传 volumeId=${targetVolumeId}。`,
        "- 章节 JSON 只允许包含 id、name、outline、content、notes、linkedSettingIds。",
        "- outline 写成约 300 字、按情节点组织的细纲。",
        "- content 初始留空；已有章节不要覆盖已写正文。",
        "- 实际创建或写入必须通过工具完成。",
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
        "当前动作：批量生成设定",
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath ?? "project/AGENTS.md"}`,
        "要求：",
        "- 必须先读取 project/AGENTS.md 和 project/outline.md。",
        "- 批量创建 settings 区域 JSON。",
        "- 设定 JSON 只允许包含 id、name、content、notes、linkedChapterIds。",
        "- content 写入基础设定信息；notes 可补充待确认事项。",
        "- 实际创建或写入必须通过工具完成。",
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
        "当前动作：更新设定",
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath}`,
        "要求：",
        "- 必须先读取当前设定 JSON。",
        "- 读取最新章节正文、章节细纲与 project/outline.md。",
        "- 更新当前设定的 content、notes、linkedChapterIds。",
        "- 如果剧情产生新设定，创建新的 settings JSON。",
        "- 所有变更通过工具真实写回。",
      ].join("\n"),
      targetLabel,
    });
  }

  function handleWorkspaceChapterWrite() {
    const targetLabel = requireActionTarget(buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null), "请先打开一个章节");
    if (!targetLabel) {
      return;
    }
    void runWorkspaceAgentAction({
      actionId: "chapter-write",
      actionLabel: "章节写作",
      description: "根据本章细纲、相关设定和前后文章写本章正文。",
      prompt: [
        "当前动作：章节写作",
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath}`,
        "要求：",
        "- 必须先读取当前章节 JSON，重点读取 outline、content、notes、linkedSettingIds。",
        "- 根据 linkedSettingIds 读取相关设定。",
        "- 读取前后章节的细纲与正文，保证剧情、人物状态和时间线连续。",
        "- 在遵守当前章节细纲的前提下生成并写回本章 content。",
        "- 可同步补充 notes 与 linkedSettingIds。",
        "- 所有写回必须通过工具完成。",
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
        "当前动作：设定更新",
        `当前目标：${targetLabel}`,
        `当前文件：${currentFilePath}`,
        "要求：",
        "- 必须先读取当前章节 JSON，重点读取 outline、content、notes、linkedSettingIds。",
        "- 分析本章正文涉及的人物、地点、物品、势力、概念和关系变化。",
        "- 更新已有关联设定的 content、notes、linkedChapterIds。",
        "- 如果发现新实体，创建新的 settings JSON。",
        "- 所有变更通过工具真实写回。",
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

  const availableWorkspaceActions: ExpansionWorkspaceActionButton[] =
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
    if (!workspaceId || createSettingBusy) {
      return;
    }
    const name = createSettingName.trim();
    if (!name) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setCreateSettingBusy(true);
    try {
      const created = await createExpansionEntry(workspaceId, "settings", name);
      setCreateSettingOpen(false);
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

  async function handleDeleteWorkspace() {
    if (!workspaceId || deleteWorkspaceBusy) {
      return;
    }
    setDeleteWorkspaceBusy(true);
    try {
      await deleteExpansionWorkspace(workspaceId);
      navigate(buildExpansionListRoute());
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
      setDeleteWorkspaceBusy(false);
    }
  }

  async function handleExport() {
    if (!workspaceId) {
      return;
    }
    try {
      const exported = await exportExpansionZip(workspaceId);
      if (exported) {
        setToastState({ title: "已导出 ZIP", tone: "success" });
      }
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    }
  }

  if (status === "loading") {
    return (
      <PageShell title={<DetailTitle name="加载中" />}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载扩写书籍...</div>
      </PageShell>
    );
  }

  if (status === "error" || !detail) {
    return (
      <PageShell title={<DetailTitle name="未找到" />}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <div className="space-y-3 text-center">
            <h2 className="text-base font-semibold text-foreground">未找到该扩写书籍</h2>
            <p>{errorMessage ?? "请返回列表重试。"}</p>
            <Button type="button" variant="outline" onClick={() => navigate(buildExpansionListRoute())}>
              返回扩写工坊
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
            <Button type="button" size="sm" variant="outline" onClick={() => void handleExport()}>
              <Download className="h-4 w-4" />
              导出
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={() => setDeleteWorkspaceOpen(true)}>
              删除
            </Button>
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col lg:flex-row">
          <aside className="w-full shrink-0 overflow-y-auto border-b border-border bg-app lg:w-[260px] lg:border-r lg:border-b-0">
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

            <SectionHeader
              label="设定"
              onAdd={() => {
                setCreateSettingOpen(true);
                setCreateSettingName("");
              }}
            />
            <div>
              {detail.settingEntries.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">暂无设定，点击右上角 + 新建。</div>
              ) : (
                detail.settingEntries.map((entry) => (
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
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel-subtle">
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

              <div className="min-h-0 flex-1 overflow-y-auto">
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
                    disabled={saveBusy}
                  />
                ) : selected.section === "settings" && parsedSetting ? (
                  <SettingEditor value={parsedSetting} onChange={applySetting} disabled={saveBusy} />
                ) : selected.section === "chapters" && parsedChapter ? (
                  <ChapterEditor value={parsedChapter} onChange={applyChapter} disabled={saveBusy} />
                ) : null}
              </div>
            </section>

            <ExpansionWorkspacePanel
              activeTask={activeWorkspaceTask}
              agentParts={workspaceAgentParts}
              availableActions={availableWorkspaceActions}
              currentFileName={currentFileName}
              executionPrompt={workspaceExecutionPrompt}
              onClearLogs={handleClearWorkspaceLogs}
              runStatus={workspaceRunStatus}
              targetLabel={currentSelectionLabel}
            />
          </div>
        </div>
      </PageShell>

      {createSettingOpen ? (
        <PromptDialog
          busy={createSettingBusy}
          confirmLabel="创建"
          description="新建设定 JSON，id 会按当前顺序自动分配纯数字。"
          label="设定名称"
          title="新建设定"
          value={createSettingName}
          onCancel={() => {
            if (!createSettingBusy) {
              setCreateSettingOpen(false);
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

      {deleteWorkspaceOpen ? (
        <ConfirmDialog
          busy={deleteWorkspaceBusy}
          confirmLabel="删除整本"
          description={`将整本《${detail.name}》从 SQLite 中永久删除。`}
          onCancel={() => {
            if (!deleteWorkspaceBusy) {
              setDeleteWorkspaceOpen(false);
            }
          }}
          onConfirm={() => void handleDeleteWorkspace()}
          title="删除扩写书籍"
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
