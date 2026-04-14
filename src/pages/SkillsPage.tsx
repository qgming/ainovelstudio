import { Plus, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PageShell } from "../components/PageShell";
import { CreateSkillDialog } from "../components/dialogs/CreateSkillDialog";
import { SkillCard } from "../components/skills/SkillCard";
import { getResolvedSkills, useSkillsStore } from "../stores/skillsStore";
import { useNavigate } from "react-router-dom";

export function SkillsPage() {
  const navigate = useNavigate();
  const errorMessage = useSkillsStore((state) => state.errorMessage);
  const lastScannedAt = useSkillsStore((state) => state.lastScannedAt);
  const manifests = useSkillsStore((state) => state.manifests);
  const preferences = useSkillsStore((state) => state.preferences);
  const status = useSkillsStore((state) => state.status);
  const toggleSkill = useSkillsStore((state) => state.toggleSkill);
  const initialize = useSkillsStore((state) => state.initialize);
  const refresh = useSkillsStore((state) => state.refresh);
  const importSkillPackage = useSkillsStore((state) => state.importSkillPackage);
  const createSkill = useSkillsStore((state) => state.createSkill);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (status === "idle") {
      void initialize();
    }
  }, [initialize, status]);

  const skills = getResolvedSkills({ manifests, preferences });
  const builtinCount = skills.filter((skill) => skill.sourceKind === "builtin-package").length;
  const installedCount = skills.filter((skill) => skill.sourceKind === "installed-package").length;
  const invalidCount = skills.filter((skill) => !skill.validation.isValid).length;

  async function handleCreateSkill() {
    if (createBusy) {
      return;
    }

    const name = draftName.trim();
    const description = draftDescription.trim();
    if (!name || !description) {
      return;
    }

    setCreateBusy(true);
    try {
      const skillId = await createSkill(name, description);
      setCreateDialogOpen(false);
      setDraftName("");
      setDraftDescription("");
      navigate(`/skills/${skillId}`);
    } finally {
      setCreateBusy(false);
    }
  }

  function closeCreateDialog() {
    if (createBusy) {
      return;
    }
    setCreateDialogOpen(false);
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file) {
      return;
    }

    const archiveBytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    await importSkillPackage(file.name, archiveBytes);
  }

  return (
    <>
      <PageShell
        title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">技能中心</h1>}
        actions={[
          { icon: RefreshCw, label: "刷新技能库", tone: "default", onClick: () => void refresh() },
          { icon: Upload, label: "导入技能", tone: "default", onClick: () => importInputRef.current?.click() },
          { icon: Plus, label: "新建技能", tone: "primary", onClick: () => setCreateDialogOpen(true) },
        ]}
      >
        <input
          ref={importInputRef}
          hidden
          accept=".zip,application/zip"
          type="file"
          onChange={(event) => void handleImportChange(event)}
        />
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-4 py-3 text-xs text-[#526074] dark:border-[#20242b] dark:text-zinc-400 sm:px-5">
            <span>共 {skills.length} 个技能</span>
            <span>内置 {builtinCount}</span>
            <span>已安装 {installedCount}</span>
            {invalidCount > 0 ? <span>异常 {invalidCount}</span> : null}
            {lastScannedAt ? <span>最近扫描 {new Date(lastScannedAt).toLocaleTimeString()}</span> : null}
          </div>

          {errorMessage ? (
            <div className="border-b border-[#f1d1d1] bg-[#fff5f5] px-4 py-3 text-sm text-[#b42318] dark:border-[#4a2323] dark:bg-[#221314] dark:text-[#ffb4ab] sm:px-5">
              <p className="font-medium">技能导入/扫描失败</p>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
            </div>
          ) : null}

          <div className="h-full overflow-y-auto">
            {status === "loading" ? (
              <div className="flex h-full min-h-[240px] items-center justify-center border-t border-[#e2e8f0] px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:text-zinc-400">
                正在扫描技能库…
              </div>
            ) : skills.length > 0 ? (
              <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7 dark:border-[#20242b]">
                {skills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    onOpen={() => navigate(`/skills/${skill.id}`)}
                    onToggle={() => toggleSkill(skill.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center border-t border-[#e2e8f0] px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:text-zinc-400">
                暂无可用技能，请导入标准 ZIP 技能包或新建技能。
              </div>
            )}
          </div>
        </div>
      </PageShell>
      {createDialogOpen ? (
        <CreateSkillDialog
          busy={createBusy}
          description={draftDescription}
          name={draftName}
          onCancel={closeCreateDialog}
          onChangeDescription={setDraftDescription}
          onChangeName={setDraftName}
          onConfirm={() => void handleCreateSkill()}
        />
      ) : null}
    </>
  );
}
