import { Plus, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { PageShell } from "../components/PageShell";
import { CreateSkillDialog } from "../components/dialogs/CreateSkillDialog";
import { SkillCard } from "../components/skills/SkillCard";
import { getResolvedSkills, useSkillsStore } from "../stores/skillsStore";
import { useNavigate } from "react-router-dom";

export function SkillsPage() {
  const navigate = useNavigate();
  const errorMessage = useSkillsStore((state) => state.errorMessage);
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
          {errorMessage ? (
            <div className="editor-callout" data-tone="error">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
            </div>
          ) : null}

          <div className="h-full overflow-y-auto">
            {status === "loading" ? (
              <div className="editor-empty-state border-t-0 border-solid bg-panel">
                正在扫描技能库…
              </div>
            ) : skills.length > 0 ? (
              <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
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
              <div className="editor-empty-state border-t-0">
                <div>
                  <h2 className="editor-empty-state-title text-xl">暂无可用技能</h2>
                  <p className="editor-empty-state-copy">
                    请导入标准 ZIP 技能包，或直接创建一个新的技能工作区。
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                      导入技能
                    </Button>
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="h-4 w-4" />
                      新建技能
                    </Button>
                  </div>
                </div>
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
