/**
 * 扩写工作区详情页（页面壳）。
 *
 * 该页面历史上承担了 ~1800 行职责：纯函数解析、JSON 编码、子组件、
 * AI 工作区运行时、文件树 CRUD、对话框、移动端 tab 等都混在一起。
 *
 * 经阶段 5 拆分，本文件目标：
 *   - 仅作为页面壳：路由参数、加载/错误分支、组合容器
 *   - 业务逻辑分散到：lib/expansion/metaCodec、components/expansion/detail/*、hooks/expansion/*
 *
 * 当前仍保留较多组件状态（文件 CRUD 对话框、选中态等），未来可继续抽 useExpansionEntryMutations。
 */

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  LoaderCircle,
  Plus,
  Save,
  Square,
  SquarePen,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { Toast, type ToastTone } from "../components/common/Toast";
import { LoadingBlock } from "../components/common/LoadingBlock";
import { ErrorBlock } from "../components/common/ErrorBlock";
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
} from "../components/expansion/detail/ExpansionWorkspacePanel";
import { BatchOutlineVolumeDialog } from "../components/expansion/detail/BatchOutlineVolumeDialog";
import {
  DetailTitle,
  EntryButton,
  SectionHeader,
} from "../components/expansion/detail/ExpansionDetailParts";
import { DialogShell } from "../components/dialogs/DialogShell";
import { Button } from "../components/ui/button";
import { BusyButton } from "../components/ui/busy-button";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
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
import {
  buildChapterEntryLabel,
  buildChapterTargetLabel,
  buildSettingMetaContent,
  buildVolumeMetaContent,
  DEFAULT_SETTING_CATEGORIES,
  formatVolumeLabel,
  getChapterVolumeId,
  getNextVolumeId,
  getProjectEntryLabel,
  getReadableError,
  getSettingCategory,
  getSettingEntryId,
  getSettingFallbackName,
  HIDDEN_CHAPTER_META_PATH,
  HIDDEN_SETTING_META_PATH,
  normalizeVolumeId,
  parseChapterMeta,
  parseSettingMeta,
  sanitizeChapterJson,
  sanitizeSettingJson,
  sortSettingCategories,
} from "../lib/expansion/metaCodec";
import { buildExpansionListRoute } from "../lib/expansion/routes";
import type {
  ChapterJson,
  ExpansionSection,
  ExpansionWorkspaceDetail,
  SettingJson,
} from "../lib/expansion/types";
import { useIsMobile } from "../hooks/use-mobile";
import { useExpansionWorkspaceAgent } from "../hooks/expansion/useExpansionWorkspaceAgent";
import { useExpansionPromptTemplates } from "../hooks/expansion/useExpansionPromptTemplates";
import { composePrompt } from "../lib/expansion/promptTemplates";
import { PromptTemplateDialog } from "../components/expansion/detail/PromptTemplateDialog";
import { cn } from "../lib/utils";

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

export function ExpansionDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // —— 数据加载与选中态 ——
  const [detail, setDetail] = useState<ExpansionWorkspaceDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedKey>(null);
  const [rawContent, setRawContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [toastState, setToastState] = useState<ToastState | null>(null);

  // —— 分卷 / 分类元数据 ——
  const [volumeIds, setVolumeIds] = useState<string[]>([]);
  const [volumeExpanded, setVolumeExpanded] = useState<Record<string, boolean>>({});
  const [settingCategories, setSettingCategories] =
    useState<string[]>(DEFAULT_SETTING_CATEGORIES);
  const [settingExpanded, setSettingExpanded] = useState<Record<string, boolean>>({});

  // —— 创建 / 重命名 / 删除对话框 ——
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
  const [renameTarget, setRenameTarget] = useState<{
    section: "settings" | "chapters";
    path: string;
    current: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    section: "settings" | "chapters";
    path: string;
    name: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<MobileExpansionTab>("editor");

  // —— Memo selectors（基于 detail / selected / 内容） ——
  const visibleProjectEntries = useMemo(
    () =>
      detail?.projectEntries.filter(
        (entry) =>
          entry.path !== HIDDEN_CHAPTER_META_PATH && entry.path !== HIDDEN_SETTING_META_PATH,
      ) ?? [],
    [detail?.projectEntries],
  );

  const selectedSettingEntry = useMemo(() => {
    if (!detail || selected?.section !== "settings") return null;
    return detail.settingEntries.find((entry) => entry.path === selected.path) ?? null;
  }, [detail, selected]);

  const selectedChapterEntry = useMemo(() => {
    if (!detail || selected?.section !== "chapters") return null;
    return detail.chapterEntries.find((entry) => entry.path === selected.path) ?? null;
  }, [detail, selected]);

  const parsedSetting = useMemo(() => {
    if (selected?.section !== "settings") return null;
    const fallbackId = selectedSettingEntry?.entryId ?? getSettingEntryId(selected.path);
    const fallbackName = selectedSettingEntry?.name ?? getSettingFallbackName(selected.path);
    return parseSettingJson(rawContent, fallbackId, fallbackName);
  }, [rawContent, selected, selectedSettingEntry]);

  const parsedChapter = useMemo(() => {
    if (selected?.section !== "chapters") return null;
    return parseChapterJson(
      rawContent,
      selectedChapterEntry?.entryId ?? "",
      selectedChapterEntry?.name ?? selected.path,
    );
  }, [rawContent, selected, selectedChapterEntry]);

  const settingGroups = useMemo<SettingCategoryGroup[]>(() => {
    if (!detail) return [];
    const groups = new Map<string, ExpansionWorkspaceDetail["settingEntries"]>();
    for (const category of settingCategories) groups.set(category, []);
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
    if (!detail) return [];
    const groups = new Map<string, ExpansionWorkspaceDetail["chapterEntries"]>();
    for (const volumeId of volumeIds) groups.set(volumeId, []);
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

  const currentFilePath = selected ? `${selected.section}/${selected.path}` : null;

  const currentFileName = useMemo(() => {
    if (!selected) return null;
    if (selected.section === "project") return selected.path;
    if (selected.section === "settings") {
      return parsedSetting?.name ?? selectedSettingEntry?.name ?? selected.path;
    }
    return parsedChapter?.name ?? selectedChapterEntry?.name ?? selected.path;
  }, [
    parsedChapter?.name,
    parsedSetting?.name,
    selected,
    selectedChapterEntry?.name,
    selectedSettingEntry?.name,
  ]);

  const currentSelectionLabel = useMemo(() => {
    if (!selected) return null;
    if (selected.section === "project") return selected.path;
    if (selected.section === "settings") {
      return parsedSetting?.name ?? selectedSettingEntry?.name ?? "设定";
    }
    return buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null);
  }, [
    parsedChapter,
    parsedSetting?.name,
    selected,
    selectedChapterEntry?.name,
    selectedSettingEntry?.name,
  ]);

  // —— 工作区 AI Hook ——
  const {
    activeTask: activeWorkspaceTask,
    agentParts: workspaceAgentParts,
    executionPrompt: workspaceExecutionPrompt,
    runStatus: workspaceRunStatus,
    runAction,
    reset: resetWorkspaceAgent,
    stopAction: stopWorkspaceAction,
    stopRequested: workspaceStopRequested,
  } = useExpansionWorkspaceAgent({
    workspaceId,
    workspaceName: detail?.name ?? null,
    currentFilePath,
    projectEntries: visibleProjectEntries,
    onWorkspaceMutated: async () => {
      await loadDetail();
      await refreshSelectedEntry();
    },
    onError: (message) => setToastState({ title: message, tone: "error" }),
  });

  // —— 提示词主体（按 workspaceId 隔离，仅指令部分可编辑） ——
  const {
    getBody: getPromptBody,
    isCustomized: isPromptCustomized,
    resetBody: resetPromptBody,
    saveBody: savePromptBody,
  } = useExpansionPromptTemplates(workspaceId);
  const [editingActionId, setEditingActionId] =
    useState<ExpansionWorkspaceActionId | null>(null);

  // —— Effects：加载详情、读元数据、内容获取、移动端 tab 同步 ——
  useEffect(() => {
    if (!workspaceId) return;
    void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    resetWorkspaceAgent();
  }, [workspaceId, resetWorkspaceAgent]);

  useEffect(() => {
    if (!workspaceId || !detail) return;
    let cancelled = false;
    const derivedVolumeIds = detail.chapterEntries.map((entry) => getChapterVolumeId(entry.path));
    void readExpansionEntry(workspaceId, "project", HIDDEN_CHAPTER_META_PATH)
      .then((value) => {
        if (cancelled) return;
        setVolumeIds(
          Array.from(new Set([...parseChapterMeta(value), ...derivedVolumeIds])).sort(),
        );
      })
      .catch(() => {
        if (!cancelled) setVolumeIds(Array.from(new Set(derivedVolumeIds)).sort());
      });
    return () => {
      cancelled = true;
    };
  }, [detail, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !detail) return;
    let cancelled = false;
    const derivedCategories = detail.settingEntries.map((entry) => getSettingCategory(entry.path));
    void readExpansionEntry(workspaceId, "project", HIDDEN_SETTING_META_PATH)
      .then((value) => {
        if (cancelled) return;
        setSettingCategories(
          sortSettingCategories([
            ...DEFAULT_SETTING_CATEGORIES,
            ...parseSettingMeta(value),
            ...derivedCategories,
          ]),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSettingCategories(
            sortSettingCategories([...DEFAULT_SETTING_CATEGORIES, ...derivedCategories]),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail, workspaceId]);

  async function loadDetail() {
    if (!workspaceId) return;
    setStatus("loading");
    try {
      const next = await getExpansionWorkspaceDetail(workspaceId);
      setDetail(next);
      setStatus("ready");
      setSelected((current) => {
        if (current) return current;
        const projectEntries = next.projectEntries.filter(
          (entry) =>
            entry.path !== HIDDEN_CHAPTER_META_PATH && entry.path !== HIDDEN_SETTING_META_PATH,
        );
        const defaultEntry =
          projectEntries.find((entry) => entry.path === "README.md")
          ?? projectEntries.find((entry) => entry.path === "AGENTS.md")
          ?? projectEntries[0]
          ?? null;
        return defaultEntry ? { section: "project", path: defaultEntry.path } : null;
      });
    } catch (error) {
      setErrorMessage(getReadableError(error));
      setStatus("error");
    }
  }

  async function refreshSelectedEntry(nextSelected = selected) {
    if (!workspaceId || !nextSelected) return;
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
        if (!cancelled) setRawContent(value);
      })
      .catch((error) => {
        if (!cancelled) {
          setToastState({ title: getReadableError(error), tone: "error" });
          setRawContent("");
        }
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.path, selected?.section, workspaceId]);

  useEffect(() => {
    if (!isMobile || !selected) return;
    setMobileActiveTab("editor");
  }, [isMobile, selected?.path, selected?.section]);

  useEffect(() => {
    if (chapterVolumes.length === 0) return;
    setVolumeExpanded((current) => {
      const next = { ...current };
      for (const group of chapterVolumes) {
        if (!(group.volumeId in next)) next[group.volumeId] = true;
      }
      return next;
    });
  }, [chapterVolumes]);

  useEffect(() => {
    if (settingGroups.length === 0) return;
    setSettingExpanded((current) => {
      const next = { ...current };
      for (const group of settingGroups) {
        if (!(group.category in next)) next[group.category] = true;
      }
      return next;
    });
  }, [settingGroups]);

  // —— 顶部状态按钮（运行中 / 失败 / 已完成 / 空闲） ——
  const workspaceStatusButton = useMemo(() => {
    if (workspaceRunStatus === "running") {
      return {
        className: "text-amber-700",
        icon: LoaderCircle,
        iconClassName: "animate-spin",
        label: activeWorkspaceTask
          ? `${activeWorkspaceTask.actionLabel} · 运行中`
          : "运行中",
      };
    }
    if (activeWorkspaceTask?.statusLabel === "已终止") {
      return {
        className: "text-muted-foreground",
        icon: Square,
        iconClassName: "",
        label: `${activeWorkspaceTask.actionLabel} · 已终止`,
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
    if (!workspaceId) return;
    await writeExpansionEntry(
      workspaceId,
      "project",
      HIDDEN_CHAPTER_META_PATH,
      buildVolumeMetaContent(nextVolumeIds),
    );
  }

  async function saveSettingMeta(nextCategories: string[]) {
    if (!workspaceId) return;
    await writeExpansionEntry(
      workspaceId,
      "project",
      HIDDEN_SETTING_META_PATH,
      buildSettingMetaContent(nextCategories),
    );
  }

  function requireActionTarget(targetLabel: string | null, errorTitle: string) {
    if (targetLabel) return targetLabel;
    setToastState({ title: errorTitle, tone: "error" });
    return null;
  }

  function openBatchOutlineDialog() {
    setBatchOutlineVolumeValue(volumeIds[0] ?? "001");
    setBatchOutlineVolumeOpen(true);
  }

  async function handleWorkspaceBatchOutline() {
    const targetLabel = requireActionTarget(currentSelectionLabel, "请先打开一个项目文件");
    if (!targetLabel) return;
    const targetVolumeId = normalizeVolumeId(batchOutlineVolumeValue || volumeIds[0] || "001");
    const targetVolumeEntries =
      chapterVolumes.find((group) => group.volumeId === targetVolumeId)?.entries ?? [];
    const nextVolumeIds = Array.from(new Set([...volumeIds, targetVolumeId])).sort();
    if (workspaceId && !volumeIds.includes(targetVolumeId)) {
      await saveVolumeMeta(nextVolumeIds);
      setVolumeIds(nextVolumeIds);
      setVolumeExpanded((current) => ({ ...current, [targetVolumeId]: true }));
    }
    setBatchOutlineVolumeOpen(false);
    const targetVolumeSnapshot =
      targetVolumeEntries.length > 0
        ? targetVolumeEntries
            .map(
              (entry) =>
                `- ${entry.entryId ? `第${entry.entryId}章` : entry.path}｜${entry.name}｜chapters/${entry.path}`,
            )
            .join("\n")
        : "（当前分卷还没有现有细纲文件）";
    void runAction({
      actionId: "project-batch-outline",
      actionLabel: "批量生成细纲",
      description: "根据大纲批量创建章节 JSON，并写入章节名与约 300 字细纲。",
      prompt: composePrompt("project-batch-outline", getPromptBody("project-batch-outline"), {
        currentFilePath,
        targetLabel,
        targetVolumeId,
        targetVolumeLabel: formatVolumeLabel(targetVolumeId),
        targetVolumeSnapshot,
      }),
      targetLabel,
    });
  }

  function handleWorkspaceBatchSettings() {
    const targetLabel = requireActionTarget(currentSelectionLabel, "请先打开一个项目文件");
    if (!targetLabel) return;
    void runAction({
      actionId: "project-batch-settings",
      actionLabel: "批量生成设定",
      description: "根据 README、大纲和工作区规则批量生成设定 JSON。",
      prompt: composePrompt("project-batch-settings", getPromptBody("project-batch-settings"), {
        currentFilePath,
        targetLabel,
      }),
      targetLabel,
    });
  }

  function handleWorkspaceSettingUpdate() {
    const targetLabel = requireActionTarget(
      parsedSetting?.name ?? selectedSettingEntry?.name ?? null,
      "请先打开一个设定文件",
    );
    if (!targetLabel) return;
    void runAction({
      actionId: "setting-update",
      actionLabel: "更新设定",
      description: "根据最新章节梗概、正文和全书大纲更新当前设定。",
      prompt: composePrompt("setting-update", getPromptBody("setting-update"), {
        currentFilePath,
        targetLabel,
      }),
      targetLabel,
    });
  }

  function handleWorkspaceChapterWrite() {
    const targetLabel = requireActionTarget(
      buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null),
      "请先打开一个章节",
    );
    if (!targetLabel) return;
    const currentOutline = parsedChapter?.outline?.trim() || "（当前章节细纲为空）";
    void runAction({
      actionId: "chapter-write",
      actionLabel: "章节写作",
      description: "根据本章细纲、相关设定和前后文章写本章正文。",
      prompt: composePrompt("chapter-write", getPromptBody("chapter-write"), {
        currentFilePath,
        currentOutline,
        targetLabel,
      }),
      targetLabel,
    });
  }

  function handleWorkspaceChapterSettingUpdate() {
    const targetLabel = requireActionTarget(
      buildChapterTargetLabel(parsedChapter, selectedChapterEntry?.name ?? null),
      "请先打开一个章节",
    );
    if (!targetLabel) return;
    void runAction({
      actionId: "chapter-setting-update",
      actionLabel: "设定更新",
      description: "分析本章正文涉及的内容，更新相关设定并补充新增设定。",
      prompt: composePrompt("chapter-setting-update", getPromptBody("chapter-setting-update"), {
        currentFilePath,
        targetLabel,
      }),
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
    const targetLabel =
      currentSelectionLabel ?? currentFileName ?? detail?.name ?? "当前工作区";
    setFreeInputOpen(false);
    setFreeInputValue("");
    void runAction({
      actionId: "free-input",
      actionLabel: "自由输入",
      description: "根据自定义提示词在当前工作区内执行 AI 操作。",
      prompt: composePrompt("free-input", getPromptBody("free-input"), {
        currentFilePath,
        targetLabel,
        userPrompt,
      }),
      targetLabel,
    });
  }

  function handleClearWorkspaceLogs() {
    resetWorkspaceAgent();
  }

  // —— 上下文 / 选中 section 决定的可用动作 ——
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
  const baseWorkspaceActions: ExpansionWorkspaceActionButton[] = [
    ...contextualWorkspaceActions,
    {
      description: "",
      id: "free-input",
      label: "自由输入",
      onClick: openWorkspaceFreeInputDialog,
    },
  ];
  const availableWorkspaceActions: ExpansionWorkspaceActionButton[] = baseWorkspaceActions.map(
    (action) => ({
      ...action,
      onEditTemplate: () => setEditingActionId(action.id),
      templateCustomized: isPromptCustomized(action.id),
    }),
  );

  // —— 文件 CRUD handlers ——
  async function handleSave() {
    if (!workspaceId || !selected || !isDirty || saveBusy) return;
    setSaveBusy(true);
    try {
      let nextSelected = selected;
      let nextContent = rawContent;

      if (selected.section === "settings" && parsedSetting && detail) {
        const sanitized = sanitizeSettingJson(parsedSetting);
        const currentEntry = detail.settingEntries.find((entry) => entry.path === selected.path);
        if (currentEntry && sanitized.name && sanitized.name !== currentEntry.name) {
          const renamed = await renameExpansionEntry(
            workspaceId,
            "settings",
            selected.path,
            sanitized.name,
          );
          nextSelected = { section: renamed.section, path: renamed.path };
          setSelected(nextSelected);
        }
        nextContent = serializeJson(sanitized);
      }

      if (selected.section === "chapters" && parsedChapter && detail) {
        const sanitized = sanitizeChapterJson(parsedChapter);
        const currentEntry = detail.chapterEntries.find((entry) => entry.path === selected.path);
        if (currentEntry && sanitized.name && sanitized.name !== currentEntry.name) {
          const renamed = await renameExpansionEntry(
            workspaceId,
            "chapters",
            selected.path,
            sanitized.name,
          );
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
    if (!workspaceId || !createSettingCategory || createSettingBusy) return;
    const name = createSettingName.trim();
    if (!name) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setCreateSettingBusy(true);
    try {
      const nextCategories = sortSettingCategories([
        ...settingCategories,
        createSettingCategory,
      ]);
      await saveSettingMeta(nextCategories);
      const created = await createExpansionEntry(
        workspaceId,
        "settings",
        name,
        createSettingCategory,
      );
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
    if (!workspaceId || createVolumeBusy) return;
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
    if (!workspaceId || !createChapterVolumeId || createChapterBusy) return;
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
    if (!workspaceId || !renameTarget || renameBusy) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setRenameBusy(true);
    try {
      const updated = await renameExpansionEntry(
        workspaceId,
        renameTarget.section,
        renameTarget.path,
        nextName,
      );
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
    if (!workspaceId || !deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteExpansionEntry(workspaceId, deleteTarget.section, deleteTarget.path);
      const wasSelected =
        selected?.section === deleteTarget.section && selected.path === deleteTarget.path;
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

  // —— 三栏渲染 ——
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
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {group.category}
                      </div>
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
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          当前分类暂无设定。
                        </div>
                      ) : (
                        group.entries.map((entry) => (
                          <EntryButton
                            key={`setting-${entry.path}`}
                            active={
                              selected?.section === "settings" && selected.path === entry.path
                            }
                            canModify
                            label={entry.name}
                            onClick={() =>
                              setSelected({ section: "settings", path: entry.path })
                            }
                            onDelete={() =>
                              setDeleteTarget({
                                section: "settings",
                                path: entry.path,
                                name: entry.name,
                              })
                            }
                            onRename={() => {
                              setRenameTarget({
                                section: "settings",
                                path: entry.path,
                                current: entry.name,
                              });
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
              <div className="px-3 py-3 text-xs text-muted-foreground">
                暂无分卷，点击右上角 + 新建。
              </div>
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
                        aria-label={
                          isExpanded
                            ? `收起${formatVolumeLabel(group.volumeId)}`
                            : `展开${formatVolumeLabel(group.volumeId)}`
                        }
                        onClick={() =>
                          setVolumeExpanded((current) => ({
                            ...current,
                            [group.volumeId]: !isExpanded,
                          }))
                        }
                        className="text-muted-foreground"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {formatVolumeLabel(group.volumeId)}
                        </div>
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
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            当前分卷暂无章节。
                          </div>
                        ) : (
                          group.entries.map((entry) => (
                            <EntryButton
                              key={`chapter-${entry.path}`}
                              active={
                                selected?.section === "chapters" && selected.path === entry.path
                              }
                              canModify
                              label={buildChapterEntryLabel(entry.entryId, entry.name)}
                              onClick={() =>
                                setSelected({ section: "chapters", path: entry.path })
                              }
                              onDelete={() =>
                                setDeleteTarget({
                                  section: "chapters",
                                  path: entry.path,
                                  name: entry.name,
                                })
                              }
                              onRename={() => {
                                setRenameTarget({
                                  section: "chapters",
                                  path: entry.path,
                                  current: entry.name,
                                });
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
            {isDirty ? (
              <span className="editor-status-chip" data-tone="warning">
                未保存
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  aria-label={saveBusy ? "保存中" : "保存"}
                  aria-busy={saveBusy}
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
            <div className="flex h-full items-center px-3 py-2 text-sm text-muted-foreground">
              正在读取内容…
            </div>
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
            <SettingEditor
              value={parsedSetting}
              onChange={applySetting}
              disabled={saveBusy}
              fitContainer={!isMobile}
            />
          ) : selected.section === "chapters" && parsedChapter ? (
            <ChapterEditor
              value={parsedChapter}
              onChange={applyChapter}
              disabled={saveBusy}
              fitContainer={!isMobile}
            />
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
                  mobileActiveTab === tab
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
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
        <LoadingBlock title="正在加载创作项目..." />
      </PageShell>
    );
  }

  if (status === "error" || !detail) {
    return (
      <PageShell title={<DetailTitle name="未找到" />}>
        <ErrorBlock
          title="未找到该创作项目"
          description={errorMessage ?? "请返回列表重试。"}
          actionLabel="返回创作台"
          onAction={() => navigate(buildExpansionListRoute())}
        />
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
              <WorkspaceStatusIcon
                className={cn("h-4 w-4", workspaceStatusButton.iconClassName)}
              />
              {workspaceStatusButton.label}
            </Button>
            {workspaceRunStatus === "running" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="终止运行"
                title={
                  workspaceStopRequested
                    ? "正在终止当前运行"
                    : "终止运行 — 立即停止当前创作台动作"
                }
                disabled={workspaceStopRequested}
                onClick={stopWorkspaceAction}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                {workspaceStopRequested ? "终止中" : "终止"}
              </Button>
            ) : null}
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

      {editingActionId ? (
        <PromptTemplateDialog
          actionId={editingActionId}
          actionLabel={
            availableWorkspaceActions.find((action) => action.id === editingActionId)?.label
            ?? editingActionId
          }
          initialBody={getPromptBody(editingActionId)}
          onCancel={() => setEditingActionId(null)}
          onReset={async () => {
            await resetPromptBody(editingActionId);
          }}
          onSave={async (body) => {
            await savePromptBody(editingActionId, body);
            setEditingActionId(null);
            setToastState({ title: "提示词已保存", tone: "success" });
          }}
        />
      ) : null}

      {createSettingCategory ? (
        <PromptDialog
          busy={createSettingBusy}
          confirmLabel="创建"
          description={`在 ${createSettingCategory} 内新建设定，id 会按当前顺序自动分配纯数字。`}
          label="设定名称"
          title="新建设定"
          value={createSettingName}
          onCancel={() => {
            if (!createSettingBusy) setCreateSettingCategory(null);
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
            if (workspaceRunStatus !== "running") setBatchOutlineVolumeOpen(false);
          }}
          onChange={setBatchOutlineVolumeValue}
          onConfirm={() => void handleWorkspaceBatchOutline()}
        />
      ) : null}

      {freeInputOpen ? (
        <DialogShell
          title="自由输入"
          onClose={() => {
            if (workspaceRunStatus !== "running") setFreeInputOpen(false);
          }}
        >
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
              <BusyButton
                type="button"
                size="sm"
                busy={workspaceRunStatus === "running"}
                busyLabel="发送中..."
                onClick={handleWorkspaceFreeInput}
              >
                发送给 AI
              </BusyButton>
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
            if (!createChapterBusy) setCreateChapterVolumeId(null);
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
            if (!renameBusy) setRenameTarget(null);
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
            if (!deleteBusy) setDeleteTarget(null);
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
