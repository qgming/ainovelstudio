import { Plus, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SubAgentRow } from "../components/agents/SubAgentRow";
import { CreateAgentDialog } from "../components/dialogs/CreateAgentDialog";
import { getResolvedAgents, useSubAgentStore } from "../stores/subAgentStore";

export function AgentsPage() {
  const navigate = useNavigate();
  const errorMessage = useSubAgentStore((state) => state.errorMessage);
  const lastScannedAt = useSubAgentStore((state) => state.lastScannedAt);
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
  const builtinCount = agents.filter((agent) => agent.sourceKind === "builtin-package").length;
  const installedCount = agents.filter((agent) => agent.sourceKind === "installed-package").length;
  const invalidCount = agents.filter((agent) => !agent.validation.isValid).length;

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
        title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">代理中心</h1>}
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
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-4 py-3 text-xs text-[#526074] dark:border-[#20242b] dark:text-zinc-400 sm:px-5">
            <span>共 {agents.length} 个代理</span>
            <span>内置 {builtinCount}</span>
            <span>已安装 {installedCount}</span>
            {invalidCount > 0 ? <span>异常 {invalidCount}</span> : null}
            {lastScannedAt ? <span>最近扫描 {new Date(lastScannedAt).toLocaleTimeString()}</span> : null}
          </div>

          {errorMessage ? (
            <div className="border-b border-[#f1d1d1] bg-[#fff5f5] px-4 py-3 text-sm text-[#b42318] dark:border-[#4a2323] dark:bg-[#221314] dark:text-[#ffb4ab] sm:px-5">
              <p className="font-medium">代理导入/扫描失败</p>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
            </div>
          ) : null}

          <div className="h-full overflow-y-auto">
            {status === "loading" ? (
              <div className="flex h-full min-h-[240px] items-center justify-center border-t border-[#e2e8f0] px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:text-zinc-400">
                正在扫描代理库…
              </div>
            ) : agents.length > 0 ? (
              <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7 dark:border-[#20242b]">
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
              <div className="flex h-full min-h-[240px] items-center justify-center border-t border-[#e2e8f0] px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:text-zinc-400">
                暂无可用代理，请导入标准 ZIP 代理包或新建代理。
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
