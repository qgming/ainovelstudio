import { Plus, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SubAgentRow } from "../components/agents/SubAgentRow";
import { CreateAgentDialog } from "../components/dialogs/CreateAgentDialog";
import { getResolvedAgents, useSubAgentStore } from "../stores/subAgentStore";

export function AgentsPage() {
  const navigate = useNavigate();
  const errorMessage = useSubAgentStore((state) => state.errorMessage);
  const manifests = useSubAgentStore((state) => state.manifests);
  const preferences = useSubAgentStore((state) => state.preferences);
  const status = useSubAgentStore((state) => state.status);
  const toggleAgent = useSubAgentStore((state) => state.toggleAgent);
  const initialize = useSubAgentStore((state) => state.initialize);
  const refresh = useSubAgentStore((state) => state.refresh);
  const importAgentPackage = useSubAgentStore((state) => state.importAgentPackage);
  const createAgent = useSubAgentStore((state) => state.createAgent);
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

  const agents = getResolvedAgents({ manifests, preferences });

  async function handleCreateAgent() {
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
      const agentId = await createAgent(name, description);
      setCreateDialogOpen(false);
      setDraftName("");
      setDraftDescription("");
      navigate(`/agents/${agentId}`);
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
    await importAgentPackage(file.name, archiveBytes);
  }

  return (
    <>
      <PageShell
        title={<div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">代理库</div>}
        actions={[
          { icon: RefreshCw, label: "刷新代理库", tone: "default", onClick: () => void refresh() },
          { icon: Upload, label: "导入代理", tone: "default", onClick: () => importInputRef.current?.click() },
          { icon: Plus, label: "新建代理", tone: "primary", onClick: () => setCreateDialogOpen(true) },
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
                正在扫描代理库…
              </div>
            ) : agents.length > 0 ? (
              <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                {agents.map((agent) => (
                  <SubAgentRow
                    key={agent.id}
                    agent={agent}
                    onOpen={() => navigate(`/agents/${agent.id}`)}
                    onToggle={() => toggleAgent(agent.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="editor-empty-state border-t-0">
                <div>
                  <h2 className="editor-empty-state-title text-xl">暂无可用代理</h2>
                  <p className="editor-empty-state-copy">
                    请导入标准 ZIP 代理包，或直接创建一个新的代理模板。
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                      导入代理
                    </Button>
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="h-4 w-4" />
                      新建代理
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageShell>
      {createDialogOpen ? (
        <CreateAgentDialog
          busy={createBusy}
          description={draftDescription}
          name={draftName}
          onCancel={closeCreateDialog}
          onChangeDescription={setDraftDescription}
          onChangeName={setDraftName}
          onConfirm={() => void handleCreateAgent()}
        />
      ) : null}
    </>
  );
}
