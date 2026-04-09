import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CreateReferenceDialog } from "../components/dialogs/CreateReferenceDialog";
import { PageShell } from "../components/PageShell";
import { Switch } from "../components/ui/Switch";
import { readSkillFileContent, writeSkillFileContent } from "../lib/skills/api";
import { getResolvedSkills, useSkillsStore } from "../stores/skillsStore";

function DetailTitle({ currentLabel, parentLabel, parentTo }: { currentLabel: string; parentLabel: string; parentTo: string }) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">
      <Link to={parentTo} className="transition-colors hover:text-[#475569] dark:hover:text-zinc-300">
        {parentLabel}
      </Link>
      <span className="px-1.5 text-[#94a3b8] dark:text-zinc-500">/</span>
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
      className={[
        "flex w-full items-center border-b border-[#e2e8f0] px-3 py-2 text-left transition dark:border-[#20242b]",
        active
          ? "bg-[#eaf3ff] text-[#0f172a] dark:bg-[#162131] dark:text-[#f8fbff]"
          : "text-[#334155] hover:bg-[#eef2f7] dark:text-zinc-300 dark:hover:bg-[#171b21]",
      ].join(" ")}
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

  async function handleDeleteSkill() {
    if (!skill || !isInstalledSkill || deleteLoading) {
      return;
    }

    const shouldDelete = window.confirm(`确定要删除技能“${skill.name}”吗？该操作会移除本地已安装技能目录。`);
    if (!shouldDelete) {
      return;
    }

    setDeleteLoading(true);
    try {
      await deleteInstalledSkillById(skill.id);
      navigate("/skills");
    } finally {
      setDeleteLoading(false);
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

  async function handleSelectPath(nextPath: string) {
    if (referenceLoading || saveLoading) {
      return;
    }
    if (isDirty) {
      const shouldDiscard = window.confirm("当前文件有未保存内容，确定切换吗？");
      if (!shouldDiscard) {
        return;
      }
    }
    setSelectedPath(nextPath);
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
      <PageShell title={<DetailTitle currentLabel="技能详情" parentLabel="技能中心" parentTo="/skills" />}>
        <div className="flex h-full min-h-0 items-center justify-center px-6 text-sm text-[#64748b] dark:text-zinc-400">
          <div className="space-y-3 text-center">
            <h2 className="text-base font-semibold text-[#111827] dark:text-zinc-100">未找到该技能</h2>
            <p>该技能可能已被移除，或当前链接参数无效。</p>
            <button
              type="button"
              onClick={() => navigate("/skills")}
              className="inline-flex h-9 items-center rounded-[10px] border border-[#d7dde8] px-4 text-sm font-medium text-[#111827] transition-colors hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-100 dark:hover:bg-[#1b1f26]"
            >
              返回技能中心
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        title={<DetailTitle currentLabel={skill.name} parentLabel="技能中心" parentTo="/skills" />}
        contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
        headerRight={
          <div className="flex items-center gap-2">
            {isInstalledSkill ? (
              <button
                type="button"
                onClick={() => void handleDeleteSkill()}
                disabled={deleteLoading}
                className="inline-flex h-8 items-center rounded-[8px] border border-[#d7dde8] px-3 text-[12px] font-medium text-[#b42318] transition-colors hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#4a2323] dark:text-[#ffb4ab] dark:hover:bg-[#221314]"
              >
                {deleteLoading ? "删除中..." : "删除技能"}
              </button>
            ) : null}
            <div className="flex h-8 items-center">
              <Switch checked={skill.enabled} label={`切换技能 ${skill.name}`} onChange={() => toggleSkill(skill.id)} />
            </div>
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-0 lg:flex-row">
          <aside className="w-full shrink-0 overflow-y-auto border-b border-[#e2e8f0] bg-[#f7f7f8] dark:border-[#20242b] dark:bg-[#111214] lg:w-[240px] lg:border-r lg:border-b-0">
            <div>
              <FileTreeButton active={selectedPath === "SKILL.md"} label="SKILL.md" onClick={() => void handleSelectPath("SKILL.md")} />
            </div>

            <div className="border-b border-[#e2e8f0] px-3 py-2 dark:border-[#20242b]">
              <div className="flex h-[37px] items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#64748b] dark:text-zinc-400">参考文献</span>
                {isInstalledSkill ? (
                  <button
                    type="button"
                    aria-label="添加参考文献"
                    onClick={() => setCreateReferenceOpen(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#0f172a] transition-colors duration-200 hover:bg-[#edf1f6] dark:text-[#f3f4f6] dark:hover:bg-[#1a1c21]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            <div>
              {skill.references.map((entry) => (
                <FileTreeButton
                  key={entry.path}
                  active={selectedPath === entry.path}
                  label={entry.name}
                  onClick={() => void handleSelectPath(entry.path)}
                />
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-3 py-1 dark:border-[#20242b]">
              <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
                {selectedPath}
              </h2>
              <div className="flex items-center gap-1.5">
                {isDirty ? <span className="px-2 py-1 text-xs font-medium text-[#b45309] dark:text-[#f7c680]">未保存</span> : null}
                <button
                  type="button"
                  aria-label={saveLoading ? "保存中" : "保存当前文件"}
                  onClick={() => void handleSave()}
                  disabled={saveLoading || !isDirty}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#0f172a] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#f3f4f6] dark:hover:bg-[#1a1c21]"
                >
                  <Save className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
              {referenceLoading ? (
                <div className="flex h-full items-center px-3 py-2 text-sm text-[#64748b] dark:text-zinc-400">正在读取文件内容…</div>
              ) : referenceError ? (
                <div className="flex h-full items-center px-3 py-2 text-sm text-[#b42318] dark:text-[#ffb4ab]">{referenceError}</div>
              ) : (
                <textarea
                  value={draftContent}
                  onChange={(event) => {
                    setDraftContent(event.target.value);
                    setIsDirty(true);
                  }}
                  disabled={referenceLoading || saveLoading}
                  className="h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-[15px] leading-8 text-[#111827] outline-none dark:text-[#f3f4f6]"
                  spellCheck={false}
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
    </>
  );
}
