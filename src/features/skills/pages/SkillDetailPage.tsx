import {
  ArrowLeft,
  FileText,
  FolderOpen,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CreateReferenceDialog } from "@features/skills/components/CreateReferenceDialog";
import { useIsMobile } from "@shared/hooks/useMobile";
import { PageBackTitle } from "@shared/components/PageBackTitle";
import { PageShell } from "@shared/components/PageShell";
import { Button } from "@shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@shared/ui/alert-dialog";
import { SettingsActionButton } from "@features/settings/components/SettingsSectionHeader";
import { Textarea } from "@shared/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/ui/tooltip";
import { cn } from "@shared/utils";
import { readSkillFileContent, writeSkillFileContent } from "@features/skills/api/skillApi";
import type { SkillReferenceEntry } from "@features/skills/api/skillApi";
import { getResolvedSkills, useSkillsStore } from "@features/skills/stores/useSkillsStore";

type FileSection = {
  canCreate: boolean;
  entries: SkillReferenceEntry[];
  id: string;
  label: string;
};

type MobileSkillView = "directory" | "content";

function DetailTitle({ currentLabel, parentLabel, parentTo }: { currentLabel: string; parentLabel: string; parentTo: string }) {
  return (
    <div className="truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">
      <Link to={parentTo} className="text-muted-foreground transition-colors hover:text-foreground">
        {parentLabel}
      </Link>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>{currentLabel}</span>
    </div>
  );
}

function FileTreeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-10 w-full items-center gap-2 rounded-xl border px-3 text-left transition",
        active
          ? "border-border/45 bg-card text-foreground shadow-[0_12px_30px_rgba(15,23,42,0.055)] dark:bg-panel dark:shadow-none"
          : "border-transparent text-muted-foreground hover:border-border/30 hover:bg-panel-subtle hover:text-foreground",
      )}
    >
      <FileText className="h-4 w-4 shrink-0 opacity-75" />
      <span className="block min-w-0 truncate text-[14px] font-medium tracking-[-0.02em]">{label}</span>
    </button>
  );
}

function SkillSidebarTitle({ onBack, skillName }: { onBack: () => void; skillName: string }) {
  return (
    <PageBackTitle
      backLabel="返回技能库"
      onBack={onBack}
      title={skillName}
    />
  );
}

function DesktopSkillSidebar({
  deleteLoading,
  fileSections,
  isInstalledSkill,
  onBack,
  onCreateReference,
  onDelete,
  onSelectPath,
  selectedPath,
  skill,
}: {
  deleteLoading: boolean;
  fileSections: FileSection[];
  isInstalledSkill: boolean;
  onBack: () => void;
  onCreateReference: () => void;
  onDelete: () => void;
  onSelectPath: (path: string) => void;
  selectedPath: string;
  skill: ReturnType<typeof getResolvedSkills>[number];
}) {
  return (
    <aside className="flex h-full w-[284px] shrink-0 flex-col overflow-hidden bg-app">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 sm:px-5">
        <SkillSidebarTitle onBack={onBack} skillName={skill.name} />
        <nav className="mt-2 space-y-1" aria-label="技能文件导航">
          <FileTreeButton active={selectedPath === "SKILL.md"} label="SKILL.md" onClick={() => onSelectPath("SKILL.md")} />

          {fileSections.map((section) => (
            <section key={section.id} className="pt-2">
              <div className="mb-1 flex h-8 items-center justify-between gap-2 px-3">
                <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{section.label}</span>
                </span>
                {section.canCreate ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        aria-label={`添加${section.label}`}
                        variant="ghost"
                        size="icon-sm"
                        onClick={onCreateReference}
                        className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-panel-subtle hover:text-foreground"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{`添加${section.label}`}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <div className="space-y-1">
                {section.entries.map((entry) => (
                  <FileTreeButton
                    key={entry.path}
                    active={selectedPath === entry.path}
                    label={entry.name}
                    onClick={() => onSelectPath(entry.path)}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>

      {isInstalledSkill ? (
        <div className="shrink-0 px-4 py-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={deleteLoading}
            onClick={onDelete}
            className="h-9 w-full rounded-xl border-destructive/25 bg-destructive/10 text-[13px] text-destructive hover:border-destructive/35 hover:bg-destructive/14"
          >
            <Trash2 className="h-4 w-4" />
            {deleteLoading ? "删除中..." : "删除技能"}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function MobileSkillDirectoryPage({
  deleteLoading,
  fileSections,
  isInstalledSkill,
  onBack,
  onCreateReference,
  onDelete,
  onSelectPath,
  selectedPath,
  skill,
}: {
  deleteLoading: boolean;
  fileSections: FileSection[];
  isInstalledSkill: boolean;
  onBack: () => void;
  onCreateReference: () => void;
  onDelete: () => void;
  onSelectPath: (path: string) => void;
  selectedPath: string;
  skill: ReturnType<typeof getResolvedSkills>[number];
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <div className="flex min-h-9 shrink-0 items-center bg-app px-4">
        <SkillSidebarTitle onBack={onBack} skillName={skill.name} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <nav className="space-y-1" aria-label="技能文件导航">
          <FileTreeButton active={selectedPath === "SKILL.md"} label="SKILL.md" onClick={() => onSelectPath("SKILL.md")} />

          {fileSections.map((section) => (
            <section key={section.id} className="pt-2">
              <div className="mb-1 flex h-8 items-center justify-between gap-2 px-3">
                <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{section.label}</span>
                </span>
                {section.canCreate ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        aria-label={`添加${section.label}`}
                        variant="outline"
                        size="icon-sm"
                        onClick={onCreateReference}
                        className="h-8 w-8 rounded-xl bg-panel text-muted-foreground shadow-[0_8px_18px_rgba(15,23,42,0.045)] hover:bg-panel-subtle hover:text-foreground dark:shadow-none"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{`添加${section.label}`}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <div className="space-y-1">
                {section.entries.map((entry) => (
                  <FileTreeButton
                    key={entry.path}
                    active={selectedPath === entry.path}
                    label={entry.name}
                    onClick={() => onSelectPath(entry.path)}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>

      {isInstalledSkill ? (
        <div className="shrink-0 px-4 py-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={deleteLoading}
            onClick={onDelete}
            className="h-9 w-full rounded-xl border-destructive/25 bg-destructive/10 text-[13px] text-destructive hover:border-destructive/35 hover:bg-destructive/14"
          >
            <Trash2 className="h-4 w-4" />
            {deleteLoading ? "删除中..." : "删除技能"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SkillFileEditorCard({
  draftContent,
  isDirty,
  onBack,
  onChange,
  onSave,
  referenceError,
  referenceLoading,
  saveLoading,
  selectedPath,
  showBackButton = false,
}: {
  draftContent: string;
  isDirty: boolean;
  onBack?: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  referenceError: string | null;
  referenceLoading: boolean;
  saveLoading: boolean;
  selectedPath: string;
  showBackButton?: boolean;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/45 bg-card text-card-foreground shadow-[0_16px_42px_rgba(15,23,42,0.065)] dark:bg-panel dark:shadow-none">
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 px-3 pt-3 pb-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {showBackButton ? (
            <Button
              type="button"
              aria-label="返回目录"
              variant="ghost"
              size="icon-sm"
              onClick={onBack ?? (() => undefined)}
              className="h-8 w-8 shrink-0 rounded-full border-transparent bg-transparent text-muted-foreground shadow-none transition-colors duration-150 hover:bg-transparent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <h2 className="min-w-0 truncate text-[18px] font-semibold leading-6 tracking-[-0.04em] text-foreground">
            {selectedPath}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SettingsActionButton
            type="button"
            label={saveLoading ? "保存中" : "保存当前文件"}
            text={saveLoading ? "保存中" : "保存"}
            icon={<Save className="h-4 w-4" />}
            disabled={saveLoading || !isDirty}
            onClick={onSave}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden bg-card dark:bg-panel">
        {referenceLoading ? (
          <div className="flex h-full items-center px-5 py-4 text-sm text-muted-foreground">正在读取文件内容...</div>
        ) : referenceError ? (
          <div className="flex h-full items-center px-5 py-4 text-sm text-destructive">{referenceError}</div>
        ) : (
          <Textarea
            value={draftContent}
            onChange={(event) => onChange(event.target.value)}
            disabled={referenceLoading || saveLoading}
            spellCheck={false}
            className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-5 py-4 text-[15px] leading-8 text-foreground shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:cursor-default disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
          />
        )}
      </div>
    </section>
  );
}

export function SkillDetailPage() {
  const isMobile = useIsMobile();
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const manifests = useSkillsStore((state) => state.manifests);
  const preferences = useSkillsStore((state) => state.preferences);
  const deleteInstalledSkillById = useSkillsStore((state) => state.deleteInstalledSkillById);
  const createReferenceFile = useSkillsStore((state) => state.createReferenceFile);
  const refresh = useSkillsStore((state) => state.refresh);
  const skills = getResolvedSkills({ manifests, preferences });
  const skill = skills.find((item) => item.id === skillId);
  const isInstalledSkill = skill?.sourceKind === "installed-package";
  const fileSections = skill
    ? [
        {
          canCreate: Boolean(isInstalledSkill),
          entries: skill.references,
          id: "references",
          label: "参考文献",
        },
        {
          canCreate: false,
          entries: skill.templates ?? [],
          id: "templates",
          label: "模板",
        },
      ].filter((section) => section.id === "references" || section.entries.length > 0)
    : [];
  const [selectedPath, setSelectedPath] = useState<string>("SKILL.md");
  const [draftContent, setDraftContent] = useState<string>("");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [createReferenceOpen, setCreateReferenceOpen] = useState(false);
  const [referenceDraftName, setReferenceDraftName] = useState("");
  const [referenceCreateLoading, setReferenceCreateLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileSkillView>("directory");
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath("SKILL.md");
    setIsDirty(false);
    setMobileView("directory");
  }, [skill?.id]);

  useEffect(() => {
    if (!isMobile) {
      setMobileView("directory");
    }
  }, [isMobile]);

  async function loadFileContent(targetSkillId: string, path: string) {
    setReferenceLoading(true);
    setReferenceError(null);
    try {
      const content = await readSkillFileContent(targetSkillId, path);
      setDraftContent(content);
      setIsDirty(false);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "读取技能文件失败。");
      setDraftContent("");
      setIsDirty(false);
    } finally {
      setReferenceLoading(false);
    }
  }

  useEffect(() => {
    if (!skill) {
      setDraftContent("");
      setReferenceError(null);
      setReferenceLoading(false);
      return;
    }

    void loadFileContent(skill.id, selectedPath);
  }, [selectedPath, skill?.id]);

  async function performDelete() {
    if (!skill || !isInstalledSkill || deleteLoading) {
      return;
    }
    setDeleteLoading(true);
    try {
      await deleteInstalledSkillById(skill.id);
      navigate("/skills");
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
    }
  }

  async function handleSave() {
    if (!skill || saveLoading || !isDirty) {
      return;
    }

    setSaveLoading(true);
    setReferenceError(null);
    try {
      await writeSkillFileContent(skill.id, selectedPath, draftContent);
      await refresh();
      setIsDirty(false);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "保存技能文件失败。");
    } finally {
      setSaveLoading(false);
    }
  }

  function handleSelectPath(nextPath: string) {
    if (referenceLoading || saveLoading || nextPath === selectedPath) {
      if (isMobile && nextPath === selectedPath) {
        setMobileView("content");
      }
      return;
    }
    if (isDirty) {
      setPendingPath(nextPath);
      return;
    }
    setSelectedPath(nextPath);
    if (isMobile) {
      setMobileView("content");
    }
  }

  function confirmSwitchPath() {
    if (pendingPath) {
      setSelectedPath(pendingPath);
      setPendingPath(null);
      if (isMobile) {
        setMobileView("content");
      }
    }
  }

  function handleOpenCreateReference() {
    if (!isInstalledSkill || referenceLoading || saveLoading || referenceCreateLoading) {
      return;
    }

    if (isDirty) {
      setPendingPath("__create_reference__");
      return;
    }
    setCreateReferenceOpen(true);
  }

  async function handleCreateReference() {
    if (!skill || !isInstalledSkill || referenceCreateLoading) {
      return;
    }

    const name = referenceDraftName.trim();
    if (!name) {
      return;
    }

    setReferenceCreateLoading(true);
    try {
      const createdPath = await createReferenceFile(skill.id, name);
      setCreateReferenceOpen(false);
      setReferenceDraftName("");
      setSelectedPath(createdPath);
    } finally {
      setReferenceCreateLoading(false);
    }
  }

  if (!skill) {
    return (
      <PageShell title={<DetailTitle currentLabel="技能详情" parentLabel="技能库" parentTo="/skills" />}>
        <div className="flex h-full min-h-0 items-center justify-center bg-app px-6 text-sm text-muted-foreground">
          <div className="space-y-3 text-center">
            <h2 className="text-base font-semibold text-foreground">未找到该技能</h2>
            <p>该技能可能已被移除，或当前链接参数无效。</p>
            <Button type="button" variant="outline" onClick={() => navigate("/skills")}>
              返回技能库
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  const editorCard = (
    <SkillFileEditorCard
      draftContent={draftContent}
      isDirty={isDirty}
      onBack={() => setMobileView("directory")}
      onChange={(value) => {
        setDraftContent(value);
        setIsDirty(true);
      }}
      onSave={() => void handleSave()}
      referenceError={referenceError}
      referenceLoading={referenceLoading}
      saveLoading={saveLoading}
      selectedPath={selectedPath}
      showBackButton={isMobile}
    />
  );

  return (
    <>
      <PageShell
        contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
      >
        <div className={cn("flex h-full min-h-0 overflow-hidden bg-app", isMobile ? "flex-col" : "flex-row")}>
          {isMobile ? (
            mobileView === "directory" ? (
              <MobileSkillDirectoryPage
                deleteLoading={deleteLoading}
                fileSections={fileSections}
                isInstalledSkill={Boolean(isInstalledSkill)}
                onBack={() => navigate("/skills")}
                onCreateReference={handleOpenCreateReference}
                onDelete={() => setDeleteDialogOpen(true)}
                onSelectPath={handleSelectPath}
                selectedPath={selectedPath}
                skill={skill}
              />
            ) : (
              <main className="min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-app px-4 pb-3">
                {editorCard}
              </main>
            )
          ) : (
            <DesktopSkillSidebar
              deleteLoading={deleteLoading}
              fileSections={fileSections}
              isInstalledSkill={Boolean(isInstalledSkill)}
              onBack={() => navigate("/skills")}
              onCreateReference={handleOpenCreateReference}
              onDelete={() => setDeleteDialogOpen(true)}
              onSelectPath={handleSelectPath}
              selectedPath={selectedPath}
              skill={skill}
            />
          )}

          {!isMobile ? (
            <main className="min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-app px-4 pb-3 sm:px-5 lg:px-4">
              {editorCard}
            </main>
          ) : null}
        </div>
      </PageShell>
      {createReferenceOpen ? (
        <CreateReferenceDialog
          busy={referenceCreateLoading}
          name={referenceDraftName}
          onCancel={() => {
            if (!referenceCreateLoading) {
              setCreateReferenceOpen(false);
            }
          }}
          onChangeName={setReferenceDraftName}
          onConfirm={() => void handleCreateReference()}
        />
      ) : null}

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!deleteLoading) {
            setDeleteDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除技能</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除技能“{skill.name}”吗？该操作会移除当前已安装技能数据，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteLoading}
              onClick={(event) => {
                event.preventDefault();
                void performDelete();
              }}
            >
              {deleteLoading ? "删除中..." : "删除技能"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingPath !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPath(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃当前修改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前文件有未保存内容，切换后将丢失编辑结果。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                if (pendingPath === "__create_reference__") {
                  setPendingPath(null);
                  if (skill) {
                    void loadFileContent(skill.id, selectedPath);
                  }
                  setCreateReferenceOpen(true);
                  return;
                }
                confirmSwitchPath();
              }}
            >
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


