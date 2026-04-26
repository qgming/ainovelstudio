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

const INLINE_SKILL_RULE_NOTE =
  "本提示词已内联常用 skill 规则，优先直接执行；只有现有规则明显不足时，再补读额外技能或参考资料。";

export function buildBatchOutlinePrompt(params: {
  currentFilePath: string | null;
  targetLabel: string;
  targetVolumeEntries: ReadonlyArray<ExpansionWorkspaceDetail["chapterEntries"][number]>;
  targetVolumeId: string;
}) {
  const targetVolumeSnapshot =
    params.targetVolumeEntries.length > 0
      ? params.targetVolumeEntries
          .map(
            (entry) =>
              `- ${entry.entryId ? `第${entry.entryId}章` : entry.path}｜${entry.name}｜chapters/${entry.path}`,
          )
          .join("\n")
      : "（当前分卷还没有现有细纲文件）";

  return [
    `当前目标：${params.targetLabel}`,
    `当前文件：${params.currentFilePath ?? "project/outline.md"}`,
    `目标分卷：${params.targetVolumeId}（${formatVolumeLabel(params.targetVolumeId)}）`,
    "当前分卷已有细纲文件：",
    targetVolumeSnapshot,
    INLINE_SKILL_RULE_NOTE,
    "先读取 project/AGENTS.md、project/README.md 和 project/outline.md，确认规则、题材方向和剧情走向。",
    "优先直接开始处理；需要先说明时，用一句简短说明后继续执行。",
    "已有分卷时默认走增量同步：保留现有细纲，只处理大纲中发生变化的章节，以及当前分卷里缺失的细纲文件。",
    "细纲服务后续正文执行：先看本章承接状态，再明确本章作用、核心冲突、1-2 个推进点和章末钩子。",
    "先对照当前分卷已有细纲文件和 project/outline.md：",
    "1. 现有章节仍然有效且大纲无明显变化：不要重写。",
    "2. 现有章节对应的大纲有变化：优先用 expansion_chapter_write_content 只更新该章节的 outline。",
    `3. 大纲里应存在但当前分卷缺失的章节：调用 expansion_chapter_batch_outline 补建，且必须传 volumeId=${params.targetVolumeId}。`,
    "4. 不要为了统一风格把整卷所有章节重新生成一遍。",
    "如果本卷缺失章节较多，允许分批多次调用 expansion_chapter_batch_outline，每批最多 20 章，直到当前分卷补齐。",
    "新章节 ID 不得与现有冲突，不确定时先用 expansion_continuity_scan 校验。",
    "outline 约 300 字，必须包含：本章主爽点（升级/打脸/收编/扮猪吃虎等）、核心冲突、关键转折、章末钩子（悬念/战斗/反转/情绪）。",
    "卷内节奏：起始章定调，中段递进，卷末高潮。单章 1 个核心冲突 + 1-2 个推进点，避免灌水。",
    "所有增量修改和补建完成后，只输出一句简短完成说明。",
  ].join("\n");
}

export function buildBatchSettingsPrompt(params: {
  currentFilePath: string | null;
  targetLabel: string;
}) {
  return [
    `当前目标：${params.targetLabel}`,
    `当前文件：${params.currentFilePath ?? "project/README.md"}`,
    INLINE_SKILL_RULE_NOTE,
    "先读取 project/AGENTS.md、project/README.md 和 project/outline.md，再决定要建哪些设定。",
    "先提取题材、主线冲突、主角定位、世界规则、势力关系和平台偏好，优先固化会直接影响后续写作的硬设定。",
    "区分已确认事实与待确认项，不要把推测写成已确认 canon。",
    "覆盖类别按需选择：人物 / 地点 / 势力 / 世界观 / 道具；主角与重要配角必须包含。",
    "主角设定必含：金手指、性格主标签、行事原则、社交模式。",
    "反派/对手设定必含：威胁层级、与主角差距、击败条件。",
    "世界观设定必含：力量体系等阶、升级路径、顶端是什么。",
    "阵营/势力设定必含：与主角关系、资源池、立场。",
    "尽量把人物、地点、势力、世界规则拆成稳定的独立 settings JSON，方便后续持续维护。",
    "用 expansion_setting_batch_generate 批量写回，不要走通用 write。",
  ].join("\n");
}

export function buildSettingUpdatePrompt(params: {
  currentFilePath: string | null;
  targetLabel: string;
}) {
  return [
    `当前目标：${params.targetLabel}`,
    `当前文件：${params.currentFilePath}`,
    INLINE_SKILL_RULE_NOTE,
    "先读取当前设定 JSON，再读取最新章节正文、章节细纲、project/README.md 与 project/outline.md。",
    "只更新有正文、大纲或现有设定证据支持的变化；未确认信息标为待确认，不要伪造定论。",
    "优先维护会影响后续剧情的长期 canon：身份变化、关系变化、地点状态、规则暴露和关键场景后果。",
    "仅更新与最新剧情冲突或新增的部分，未变动内容保持原文。",
    "人物状态变化必标：等级 / 实力数值 / 资源 / 关系网；用「第X章：xxx」格式追加到 content 末尾，保留历史轨迹。",
    "区分「读者已知」与「读者未知」（POV 信息差），未揭示信息标注隐藏度。",
    "如剧情产生新设定，用 expansion_setting_batch_generate 创建。",
  ].join("\n");
}

export function buildChapterWritePrompt(params: {
  currentFilePath: string | null;
  currentOutline: string;
  targetLabel: string;
}) {
  return [
    `当前目标：${params.targetLabel}`,
    `当前文件：${params.currentFilePath}`,
    "当前章节细纲：",
    params.currentOutline,
    INLINE_SKILL_RULE_NOTE,
    "先读取 project/AGENTS.md、project/README.md、相关设定文件、前后章节的细纲与正文。",
    "写前先确认上一章停点、当前人物知道什么、还不知道什么、正在推进哪条冲突线，再动笔。",
    "再核对人设、时间线、地点限制、世界规则和关键场景状态，保证承接和连续性。",
    "字数目标 汉字 2500-3500（如 project/README.md 或 project/AGENTS.md 另有约定以其为准）。",
    "开篇 200 字内必须有具体场景或冲突，不要环境描写堆砌。",
    "对话占比 ≥ 30%，避免大段心理描写或旁白；严格保持人称视角，不中途漂移。",
    "每 500 字至少一个推进点（信息释放 / 情绪转折 / 冲突升级 / 实力变化）。",
    "严格按本章 outline 推进，不擅自加超纲剧情；本章必须落地一个主爽点。",
    "正文优先用动作、对白、细节推进情绪，少概述、少解释、少贴标签。",
    "章末必须留钩子（悬念/战斗/反转/情绪任选），禁止平淡收束。",
    "写完后自检：前文承接、设定一致、时间线/空间连续、章末钩子成立，再写回 content；可按需同步补充 outline。",
  ].join("\n");
}

export function buildChapterSettingUpdatePrompt(params: {
  currentFilePath: string | null;
  targetLabel: string;
}) {
  return [
    `当前目标：${params.targetLabel}`,
    `当前文件：${params.currentFilePath}`,
    INLINE_SKILL_RULE_NOTE,
    "先读取当前章节 JSON 的 outline 与 content，分析涉及的人物、地点、物品、势力、概念和关系变化。",
    "只记录有正文证据支撑的动态变化，长期 canon 与即时状态都要能追溯到本章内容。",
    "必须更新主角的等级 / 实力数值 / 资源 / 关系网变化；用「第X章：xxx」格式追加到对应设定 content 末尾。",
    "区分「显性事件」与「暗线伏笔」，伏笔标注隐藏度（已揭示 / 部分揭示 / 未揭示）。",
    "如果同一变化会影响多份设定，逐个同步，不要把人物、地点、势力混写在一个文件里。",
    "新出场实体（NPC / 物品 / 势力）必须用 expansion_setting_batch_generate 创建独立 settings JSON。",
    "与既有设定冲突时以正文为准，反向修订设定。",
  ].join("\n");
}

export function buildFreeInputPrompt(params: {
  currentFilePath: string | null;
  targetLabel: string;
  userPrompt: string;
}) {
  return [
    `当前目标：${params.targetLabel}`,
    `当前文件：${params.currentFilePath ?? "未限定，按当前工作区处理"}`,
    INLINE_SKILL_RULE_NOTE,
    "用户输入提示词：",
    params.userPrompt,
    "先判断目标是：写回文件 / 更新设定 / 生成正文 / 大纲规划 / 仅分析建议。",
    "如果是创作或修订，优先读取当前文件、相关章节、相关设定、project/README.md 与 project/outline.md。",
    "如果是正文任务，守住人物已知信息、时间顺序、地点限制、世界规则和章末钩子。",
    "如果是设定任务，优先固化硬事实，区分已确认与待确认。",
    "如果是大纲或细纲任务，优先明确本章作用、核心冲突、推进点和钩子。",
    "如用户未限定输出形态，先判断是写回文件还是仅给建议。",
  ].join("\n");
}

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
    void runAction({
      actionId: "project-batch-outline",
      actionLabel: "批量生成细纲",
      description: "根据大纲批量创建章节 JSON，并写入章节名与约 300 字细纲。",
      prompt: buildBatchOutlinePrompt({
        currentFilePath,
        targetLabel,
        targetVolumeEntries,
        targetVolumeId,
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
      prompt: buildBatchSettingsPrompt({
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
      prompt: buildSettingUpdatePrompt({
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
      prompt: buildChapterWritePrompt({
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
      prompt: buildChapterSettingUpdatePrompt({
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
      prompt: buildFreeInputPrompt({
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
  const availableWorkspaceActions: ExpansionWorkspaceActionButton[] = [
    ...contextualWorkspaceActions,
    {
      description: "",
      id: "free-input",
      label: "自由输入",
      onClick: openWorkspaceFreeInputDialog,
    },
  ];

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
