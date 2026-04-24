import {
  ChevronDown,
  Download,
  FileText,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { Toast, type ToastTone } from "../components/common/Toast";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
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
  CHAPTER_STATUS_LABEL,
  countChineseChars,
  countWords,
  parseChapterJson,
  parseSettingJson,
  serializeJson,
} from "../lib/expansion/templates";
import { buildExpansionListRoute } from "../lib/expansion/routes";
import type {
  ChapterJson,
  ChapterStatus,
  ExpansionSection,
  ExpansionWorkspaceDetail,
  SettingJson,
  SettingType,
} from "../lib/expansion/types";
import { cn } from "../lib/utils";

type ToastState = { description?: string; title: string; tone: ToastTone };
type SelectedKey = { section: ExpansionSection; path: string } | null;
type LoadStatus = "loading" | "ready" | "error";

const SETTING_TYPE_OPTIONS: SettingType[] = ["人物", "物品", "地点", "势力", "概念"];
const CHAPTER_STATUS_OPTIONS: ChapterStatus[] = ["draft", "outlined", "drafted", "revised", "done"];

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
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
  label,
  onClick,
  onRename,
  onDelete,
  canModify,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  canModify: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center border-b border-border transition",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 min-w-0 items-center px-3 py-2 text-left"
      >
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

export function ExpansionDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ExpansionWorkspaceDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedKey>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [toastState, setToastState] = useState<ToastState | null>(null);

  // 创建条目
  const [createSection, setCreateSection] = useState<"settings" | "chapters" | null>(null);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // 重命名
  const [renameTarget, setRenameTarget] = useState<{ section: "settings" | "chapters"; path: string; current: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  // 删除条目
  const [deleteTarget, setDeleteTarget] = useState<{ section: "settings" | "chapters"; path: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // 删除整本
  const [deleteWorkspaceOpen, setDeleteWorkspaceOpen] = useState(false);
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    void loadDetail();
  }, [workspaceId]);

  async function loadDetail() {
    if (!workspaceId) return;
    setStatus("loading");
    try {
      const next = await getExpansionWorkspaceDetail(workspaceId);
      setDetail(next);
      setStatus("ready");
      // 默认选中 AGENTS.md
      if (!selected && next.projectEntries.length > 0) {
        const agents = next.projectEntries.find((entry) => entry.path === "AGENTS.md") ?? next.projectEntries[0];
        setSelected({ section: "project", path: agents.path });
      }
    } catch (error) {
      setErrorMessage(getReadableError(error));
      setStatus("error");
    }
  }

  // 加载选中条目内容
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
        if (cancelled) return;
        setRawContent(value);
      })
      .catch((error) => {
        if (cancelled) return;
        setToastState({ title: getReadableError(error), tone: "error" });
        setRawContent("");
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selected?.section, selected?.path]);

  const parsedSetting = useMemo<SettingJson | null>(() => {
    if (!selected || selected.section !== "settings") return null;
    const numericId = selected.path.split("-")[0] ?? "";
    const fallbackName = selected.path.split("-").slice(1).join("-") || selected.path;
    return parseSettingJson(rawContent, numericId, fallbackName);
  }, [rawContent, selected?.section, selected?.path]);

  const parsedChapter = useMemo<ChapterJson | null>(() => {
    if (!selected || selected.section !== "chapters") return null;
    const numericId = selected.path.split("-")[0] ?? "";
    const fallbackName = selected.path.split("-").slice(1).join("-") || selected.path;
    return parseChapterJson(rawContent, numericId, fallbackName);
  }, [rawContent, selected?.section, selected?.path]);

  function applySetting(next: SettingJson) {
    setRawContent(serializeJson({ ...next, updatedAt: Math.floor(Date.now() / 1000) }));
    setIsDirty(true);
  }

  function applyChapter(next: ChapterJson) {
    const charCount = countChineseChars(next.content);
    const wordCount = countWords(next.content);
    setRawContent(
      serializeJson({
        ...next,
        charCount,
        wordCount,
        updatedAt: Math.floor(Date.now() / 1000),
      }),
    );
    setIsDirty(true);
  }

  async function handleSave() {
    if (!workspaceId || !selected || !isDirty || saveBusy) return;
    setSaveBusy(true);
    try {
      await writeExpansionEntry(workspaceId, selected.section, selected.path, rawContent);
      setIsDirty(false);
      setToastState({ title: "已保存", tone: "success" });
      void loadDetail();
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleCreateEntry() {
    if (!workspaceId || !createSection || createBusy) return;
    const name = createName.trim();
    if (!name) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setCreateBusy(true);
    try {
      const created = await createExpansionEntry(workspaceId, createSection, name);
      setCreateSection(null);
      setCreateName("");
      await loadDetail();
      setSelected({ section: created.section, path: created.path });
    } catch (error) {
      setToastState({ title: getReadableError(error), tone: "error" });
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleRename() {
    if (!workspaceId || !renameTarget || renameBusy) return;
    const next = renameValue.trim();
    if (!next) {
      setToastState({ title: "名称不能为空", tone: "error" });
      return;
    }
    setRenameBusy(true);
    try {
      const updated = await renameExpansionEntry(workspaceId, renameTarget.section, renameTarget.path, next);
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
    if (!workspaceId || deleteWorkspaceBusy) return;
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
    if (!workspaceId) return;
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline">
                  <Sparkles className="h-4 w-4" />
                  AI 触发
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>由大纲生成章节细纲（待接入）</DropdownMenuItem>
                <DropdownMenuItem disabled>由细纲生成章节正文（待接入）</DropdownMenuItem>
                <DropdownMenuItem disabled>由正文反向更新设定（待接入）</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        <div className="flex h-full min-h-0 flex-col gap-0 lg:flex-row">
          {/* 左栏 */}
          <aside className="w-full shrink-0 overflow-y-auto border-b border-border bg-app lg:w-[260px] lg:border-r lg:border-b-0">
            <SectionHeader label="项目" />
            <div>
              {detail.projectEntries.map((entry) => (
                <EntryButton
                  key={`project-${entry.path}`}
                  active={selected?.section === "project" && selected.path === entry.path}
                  label={entry.path}
                  onClick={() => setSelected({ section: "project", path: entry.path })}
                  canModify={false}
                />
              ))}
            </div>

            <SectionHeader
              label="设定"
              onAdd={() => {
                setCreateSection("settings");
                setCreateName("");
              }}
            />
            <div>
              {detail.settingEntries.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">暂无设定，点击右上角 + 新建。</div>
              ) : (
                detail.settingEntries.map((entry) => (
                  <EntryButton
                    key={`settings-${entry.path}`}
                    active={selected?.section === "settings" && selected.path === entry.path}
                    label={`${entry.path.split("-")[0]} · ${entry.name}`}
                    onClick={() => setSelected({ section: "settings", path: entry.path })}
                    onRename={() => {
                      setRenameTarget({ section: "settings", path: entry.path, current: entry.name });
                      setRenameValue(entry.name);
                    }}
                    onDelete={() =>
                      setDeleteTarget({ section: "settings", path: entry.path, name: entry.name })
                    }
                    canModify
                  />
                ))
              )}
            </div>

            <SectionHeader
              label="章节"
              onAdd={() => {
                setCreateSection("chapters");
                setCreateName("");
              }}
            />
            <div>
              {detail.chapterEntries.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">暂无章节，点击右上角 + 新建。</div>
              ) : (
                detail.chapterEntries.map((entry) => (
                  <EntryButton
                    key={`chapters-${entry.path}`}
                    active={selected?.section === "chapters" && selected.path === entry.path}
                    label={`第 ${entry.path.split("-")[0]} 章 · ${entry.name}`}
                    onClick={() => setSelected({ section: "chapters", path: entry.path })}
                    onRename={() => {
                      setRenameTarget({ section: "chapters", path: entry.path, current: entry.name });
                      setRenameValue(entry.name);
                    }}
                    onDelete={() =>
                      setDeleteTarget({ section: "chapters", path: entry.path, name: entry.name })
                    }
                    canModify
                  />
                ))
              )}
            </div>
          </aside>

          {/* 右栏 */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel-subtle">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1">
              <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
                {selected
                  ? selected.section === "project"
                    ? selected.path
                    : selected.section === "settings"
                      ? `设定 · ${parsedSetting?.id ?? ""} ${parsedSetting?.name ?? ""}`
                      : `第 ${parsedChapter?.id ?? ""} 章 · ${parsedChapter?.name ?? ""}`
                  : "未选择"}
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
        </div>
      </PageShell>

      {createSection ? (
        <PromptDialog
          busy={createBusy}
          confirmLabel="创建"
          description={createSection === "settings" ? "新建设定 JSON，编号会按现有最大值 +1 自动分配。" : "新建章节 JSON，编号会按现有最大值 +1 自动分配。"}
          label={createSection === "settings" ? "设定名称" : "章节名称"}
          title={createSection === "settings" ? "新建设定" : "新建章节"}
          value={createName}
          onCancel={() => {
            if (createBusy) return;
            setCreateSection(null);
          }}
          onChange={setCreateName}
          onConfirm={() => void handleCreateEntry()}
        />
      ) : null}

      {renameTarget ? (
        <PromptDialog
          busy={renameBusy}
          confirmLabel="重命名"
          description="仅修改名称，编号保持不变。"
          label="新名称"
          title="重命名"
          value={renameValue}
          onCancel={() => {
            if (renameBusy) return;
            setRenameTarget(null);
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
            if (deleteBusy) return;
            setDeleteTarget(null);
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
            if (deleteWorkspaceBusy) return;
            setDeleteWorkspaceOpen(false);
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

// ===== 项目段（Markdown）编辑器 =====
function ProjectEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      spellCheck={false}
      className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
    />
  );
}

// ===== 设定 JSON 表单编辑器 =====
function SettingEditor({
  value,
  onChange,
  disabled,
}: {
  value: SettingJson;
  onChange: (next: SettingJson) => void;
  disabled: boolean;
}) {
  function update<K extends keyof SettingJson>(key: K, next: SettingJson[K]) {
    onChange({ ...value, [key]: next });
  }

  function updateAttr(key: string, val: string) {
    onChange({ ...value, attributes: { ...value.attributes, [key]: val } });
  }

  function removeAttr(key: string) {
    const next = { ...value.attributes };
    delete next[key];
    onChange({ ...value, attributes: next });
  }

  function renameAttrKey(oldKey: string, newKey: string) {
    if (!newKey || oldKey === newKey) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(value.attributes)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange({ ...value, attributes: next });
  }

  const attrEntries = Object.entries(value.attributes);

  return (
    <div className="space-y-5 px-4 py-4">
      <FormSection title="基础信息">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="编号">
            <Input value={value.id} disabled className="bg-muted/50" />
          </Field>
          <Field label="名称">
            <Input value={value.name} onChange={(event) => update("name", event.target.value)} disabled={disabled} />
          </Field>
          <Field label="类型">
            <select
              value={value.type}
              onChange={(event) => update("type", event.target.value as SettingType)}
              disabled={disabled}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            >
              {SETTING_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="别名（逗号分隔）">
            <Input
              value={value.aliases.join(", ")}
              onChange={(event) =>
                update(
                  "aliases",
                  event.target.value
                    .split(/[,，]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              }
              disabled={disabled}
            />
          </Field>
          <Field label="标签（逗号分隔）" full>
            <Input
              value={value.tags.join(", ")}
              onChange={(event) =>
                update(
                  "tags",
                  event.target.value
                    .split(/[,，]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              }
              disabled={disabled}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="一句话简介">
        <Textarea
          value={value.summary}
          onChange={(event) => update("summary", event.target.value)}
          disabled={disabled}
          rows={2}
          className="resize-none"
        />
      </FormSection>

      <FormSection title="详细描述">
        <Textarea
          value={value.description}
          onChange={(event) => update("description", event.target.value)}
          disabled={disabled}
          rows={6}
          className="resize-y"
        />
      </FormSection>

      <FormSection
        title="属性"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              let key = "新属性";
              let counter = 1;
              while (Object.prototype.hasOwnProperty.call(value.attributes, key)) {
                counter += 1;
                key = `新属性${counter}`;
              }
              updateAttr(key, "");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            添加属性
          </Button>
        }
      >
        {attrEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无属性。</p>
        ) : (
          <div className="space-y-2">
            {attrEntries.map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <Input
                  value={key}
                  onChange={(event) => renameAttrKey(key, event.target.value)}
                  disabled={disabled}
                  className="w-40"
                />
                <Input
                  value={val}
                  onChange={(event) => updateAttr(key, event.target.value)}
                  disabled={disabled}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="删除属性"
                  disabled={disabled}
                  onClick={() => removeAttr(key)}
                  className="text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection
        title="关系"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                relations: [...value.relations, { targetId: "", targetName: "", relation: "" }],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            添加关系
          </Button>
        }
      >
        {value.relations.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无关系。</p>
        ) : (
          <div className="space-y-2">
            {value.relations.map((relation, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="对象编号"
                  value={relation.targetId}
                  onChange={(event) => {
                    const next = [...value.relations];
                    next[index] = { ...next[index], targetId: event.target.value };
                    update("relations", next);
                  }}
                  disabled={disabled}
                  className="w-28"
                />
                <Input
                  placeholder="对象名称"
                  value={relation.targetName}
                  onChange={(event) => {
                    const next = [...value.relations];
                    next[index] = { ...next[index], targetName: event.target.value };
                    update("relations", next);
                  }}
                  disabled={disabled}
                  className="w-40"
                />
                <Input
                  placeholder="关系描述"
                  value={relation.relation}
                  onChange={(event) => {
                    const next = [...value.relations];
                    next[index] = { ...next[index], relation: event.target.value };
                    update("relations", next);
                  }}
                  disabled={disabled}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="删除关系"
                  disabled={disabled}
                  onClick={() =>
                    update(
                      "relations",
                      value.relations.filter((_, idx) => idx !== index),
                    )
                  }
                  className="text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="备忘">
        <Textarea
          value={value.notes}
          onChange={(event) => update("notes", event.target.value)}
          disabled={disabled}
          rows={3}
          className="resize-none"
        />
      </FormSection>

      {value.appearChapters.length > 0 ? (
        <FormSection title="出现章节（自动维护）">
          <p className="text-xs text-muted-foreground">{value.appearChapters.join("、")}</p>
        </FormSection>
      ) : null}
    </div>
  );
}

// ===== 章节 JSON 表单编辑器 =====
function ChapterEditor({
  value,
  onChange,
  disabled,
}: {
  value: ChapterJson;
  onChange: (next: ChapterJson) => void;
  disabled: boolean;
}) {
  function update<K extends keyof ChapterJson>(key: K, next: ChapterJson[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <FormSection title="头部">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="章节编号">
            <Input value={value.id} disabled className="bg-muted/50" />
          </Field>
          <Field label="章节名称">
            <Input value={value.name} onChange={(event) => update("name", event.target.value)} disabled={disabled} />
          </Field>
          <Field label="状态">
            <select
              value={value.status}
              onChange={(event) => update("status", event.target.value as ChapterStatus)}
              disabled={disabled}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            >
              {CHAPTER_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {CHAPTER_STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="元信息">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="视角">
            <Input value={value.pov} onChange={(event) => update("pov", event.target.value)} disabled={disabled} />
          </Field>
          <Field label="地点">
            <Input value={value.location} onChange={(event) => update("location", event.target.value)} disabled={disabled} />
          </Field>
          <Field label="时间线">
            <Input value={value.timeline} onChange={(event) => update("timeline", event.target.value)} disabled={disabled} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="关联设定（设定编号，逗号分隔）">
        <Input
          value={value.linkedSettingIds.join(", ")}
          onChange={(event) =>
            update(
              "linkedSettingIds",
              event.target.value
                .split(/[,，]/)
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
          disabled={disabled}
        />
      </FormSection>

      <FormSection title="本章摘要">
        <Textarea
          value={value.summary}
          onChange={(event) => update("summary", event.target.value)}
          disabled={disabled}
          rows={2}
          className="resize-none"
        />
      </FormSection>

      <FormSection title="章节细纲">
        <Textarea
          value={value.outline}
          onChange={(event) => update("outline", event.target.value)}
          disabled={disabled}
          rows={6}
          className="resize-y"
        />
      </FormSection>

      <FormSection
        title={`章节正文`}
        action={
          <span className="text-xs text-muted-foreground">
            中文字符 {countChineseChars(value.content)} · 总字符 {countWords(value.content)}
          </span>
        }
      >
        <Textarea
          value={value.content}
          onChange={(event) => update("content", event.target.value)}
          disabled={disabled}
          rows={16}
          className="resize-y font-mono text-[15px] leading-8"
        />
      </FormSection>

      <FormSection
        title="关键事件"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => update("events", [...value.events, { title: "", detail: "" }])}
          >
            <Plus className="h-3.5 w-3.5" />
            添加事件
          </Button>
        }
      >
        {value.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无事件。</p>
        ) : (
          <div className="space-y-2">
            {value.events.map((event, index) => (
              <div key={index} className="space-y-1 rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="标题"
                    value={event.title}
                    onChange={(input) => {
                      const next = [...value.events];
                      next[index] = { ...next[index], title: input.target.value };
                      update("events", next);
                    }}
                    disabled={disabled}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="删除事件"
                    disabled={disabled}
                    onClick={() => update("events", value.events.filter((_, idx) => idx !== index))}
                    className="text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  placeholder="详情"
                  value={event.detail}
                  onChange={(input) => {
                    const next = [...value.events];
                    next[index] = { ...next[index], detail: input.target.value };
                    update("events", next);
                  }}
                  disabled={disabled}
                  rows={2}
                  className="resize-none"
                />
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection
        title="伏笔"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              update("foreshadowing", [
                ...value.foreshadowing,
                { title: "", detail: "", payoffChapterId: null },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            添加伏笔
          </Button>
        }
      >
        {value.foreshadowing.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无伏笔。</p>
        ) : (
          <div className="space-y-2">
            {value.foreshadowing.map((item, index) => (
              <div key={index} className="space-y-1 rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="伏笔标题"
                    value={item.title}
                    onChange={(input) => {
                      const next = [...value.foreshadowing];
                      next[index] = { ...next[index], title: input.target.value };
                      update("foreshadowing", next);
                    }}
                    disabled={disabled}
                    className="flex-1"
                  />
                  <Input
                    placeholder="兑现章节编号"
                    value={item.payoffChapterId ?? ""}
                    onChange={(input) => {
                      const next = [...value.foreshadowing];
                      const v = input.target.value.trim();
                      next[index] = { ...next[index], payoffChapterId: v ? v : null };
                      update("foreshadowing", next);
                    }}
                    disabled={disabled}
                    className="w-40"
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="删除伏笔"
                    disabled={disabled}
                    onClick={() =>
                      update(
                        "foreshadowing",
                        value.foreshadowing.filter((_, idx) => idx !== index),
                      )
                    }
                    className="text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  placeholder="伏笔详情"
                  value={item.detail}
                  onChange={(input) => {
                    const next = [...value.foreshadowing];
                    next[index] = { ...next[index], detail: input.target.value };
                    update("foreshadowing", next);
                  }}
                  disabled={disabled}
                  rows={2}
                  className="resize-none"
                />
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="作者备忘">
        <Textarea
          value={value.notes}
          onChange={(event) => update("notes", event.target.value)}
          disabled={disabled}
          rows={3}
          className="resize-none"
        />
      </FormSection>
    </div>
  );
}

function FormSection({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <FileText className="h-3 w-3" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn("space-y-1", full && "md:col-span-2")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
