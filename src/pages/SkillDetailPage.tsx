import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CreateReferenceDialog } from "../components/dialogs/CreateReferenceDialog";
import { PageShell } from "../components/PageShell";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { readSkillFileContent, writeSkillFileContent } from "../lib/skills/api";
import { getResolvedSkills, useSkillsStore } from "../stores/skillsStore";

function DetailTitle({ currentLabel, parentLabel, parentTo }: { currentLabel: string; parentLabel: string; parentTo: string }) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
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
        "flex w-full items-center border-b border-border px-3 py-2 text-left transition",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span className="block min-w-0 truncate text-sm font-medium">{label}</span>
    </button>
  );
}

export function SkillDetailPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const manifests = useSkillsStore((state) => state.manifests);
  const preferences = useSkillsStore((state) => state.preferences);
  const toggleSkill = useSkillsStore((state) => state.toggleSkill);
  const deleteInstalledSkillById = useSkillsStore((state) => state.deleteInstalledSkillById);
  const createReferenceFile = useSkillsStore((state) => state.createReferenceFile);
  const refresh = useSkillsStore((state) => state.refresh);
  const skills = getResolvedSkills({ manifests, preferences });
  const skill = skills.find((item) => item.id === skillId);
  const isInstalledSkill = skill?.sourceKind === "installed-package";
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
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath("SKILL.md");
    setIsDirty(false);
  }, [skill?.id]);

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
      return;
    }
    if (isDirty) {
      setPendingPath(nextPath);
      return;
    }
    setSelectedPath(nextPath);
  }

  function confirmSwitchPath() {
    if (pendingPath) {
      setSelectedPath(pendingPath);
      setPendingPath(null);
    }
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
        <div className="flex h-full min-h-0 items-center justify-center px-6 text-sm text-muted-foreground">
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

  return (
    <>
      <PageShell
        title={<DetailTitle currentLabel={skill.name} parentLabel="技能库" parentTo="/skills" />}
        contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
        headerRight={
          <div className="flex items-center gap-2">
            {isInstalledSkill ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={deleteLoading}
                onClick={() => setDeleteDialogOpen(true)}
              >
                {deleteLoading ? "删除中..." : "删除技能"}
              </Button>
            ) : null}
            <div className="flex h-8 items-center">
              <Switch checked={skill.enabled} label={`切换技能 ${skill.name}`} onChange={() => toggleSkill(skill.id)} />
            </div>
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-0 lg:flex-row">
          <aside className="w-full shrink-0 overflow-y-auto border-b border-border bg-app lg:w-[240px] lg:border-r lg:border-b-0">
            <div>
              <FileTreeButton active={selectedPath === "SKILL.md"} label="SKILL.md" onClick={() => handleSelectPath("SKILL.md")} />
            </div>

            <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
              <span className="text-xs font-medium text-muted-foreground">参考文献</span>
              {isInstalledSkill ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      aria-label="添加参考文献"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setCreateReferenceOpen(true)}
                      className="text-muted-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>添加参考文献</TooltipContent>
                </Tooltip>
              ) : null}
            </div>

            <div>
              {skill.references.map((entry) => (
                <FileTreeButton
                  key={entry.path}
                  active={selectedPath === entry.path}
                  label={entry.name}
                  onClick={() => handleSelectPath(entry.path)}
                />
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel-subtle">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1">
              <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
                {selectedPath}
              </h2>
              <div className="flex items-center gap-1.5">
                {isDirty ? (
                  <span className="editor-status-chip" data-tone="warning">未保存</span>
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      aria-label={saveLoading ? "保存中" : "保存当前文件"}
                      variant="ghost"
                      size="icon-sm"
                      disabled={saveLoading || !isDirty}
                      onClick={() => void handleSave()}
                      className="text-muted-foreground"
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>保存当前文件</TooltipContent>
                </Tooltip>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
              {referenceLoading ? (
                <div className="flex h-full items-center px-3 py-2 text-sm text-muted-foreground">正在读取文件内容…</div>
              ) : referenceError ? (
                <div className="flex h-full items-center px-3 py-2 text-sm text-destructive">{referenceError}</div>
              ) : (
                <Textarea
                  value={draftContent}
                  onChange={(event) => {
                    setDraftContent(event.target.value);
                    setIsDirty(true);
                  }}
                  disabled={referenceLoading || saveLoading}
                  spellCheck={false}
                  className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
                />
              )}
            </div>
          </section>
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
