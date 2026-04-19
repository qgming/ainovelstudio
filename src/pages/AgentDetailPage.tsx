import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { readAgentFileContent, writeAgentFileContent } from "../lib/agents/api";
import { getResolvedAgents, useSubAgentStore } from "../stores/subAgentStore";

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

const PRIMARY_FILES = ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"] as const;

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const manifests = useSubAgentStore((state) => state.manifests);
  const preferences = useSubAgentStore((state) => state.preferences);
  const toggleAgent = useSubAgentStore((state) => state.toggleAgent);
  const deleteInstalledAgentById = useSubAgentStore((state) => state.deleteInstalledAgentById);
  const refresh = useSubAgentStore((state) => state.refresh);
  const agents = getResolvedAgents({ manifests, preferences });
  const agent = agents.find((item) => item.id === agentId);
  const isInstalledAgent = agent?.sourceKind === "installed-package";
  const [selectedPath, setSelectedPath] = useState<string>("manifest.json");
  const [draftContent, setDraftContent] = useState<string>("");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath("manifest.json");
    setIsDirty(false);
  }, [agent?.id]);

  async function loadFileContent(targetAgentId: string, path: string) {
    setReferenceLoading(true);
    setReferenceError(null);
    try {
      const content = await readAgentFileContent(targetAgentId, path);
      setDraftContent(content);
      setIsDirty(false);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "读取代理文件失败。");
      setDraftContent("");
      setIsDirty(false);
    } finally {
      setReferenceLoading(false);
    }
  }

  useEffect(() => {
    if (!agent) {
      setDraftContent("");
      setReferenceError(null);
      setReferenceLoading(false);
      return;
    }

    void loadFileContent(agent.id, selectedPath);
  }, [selectedPath, agent?.id]);

  async function performDelete() {
    if (!agent || !isInstalledAgent || deleteLoading) {
      return;
    }
    setDeleteLoading(true);
    try {
      await deleteInstalledAgentById(agent.id);
      navigate("/agents");
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
    }
  }

  async function handleSave() {
    if (!agent || saveLoading || !isDirty) {
      return;
    }

    setSaveLoading(true);
    setReferenceError(null);
    try {
      await writeAgentFileContent(agent.id, selectedPath, draftContent);
      await refresh();
      setIsDirty(false);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "保存代理文件失败。");
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

  if (!agent) {
    return (
      <PageShell title={<DetailTitle currentLabel="代理详情" parentLabel="代理库" parentTo="/agents" />}>
        <div className="flex h-full min-h-0 items-center justify-center px-6 text-sm text-muted-foreground">
          <div className="space-y-3 text-center">
            <h2 className="text-base font-semibold text-foreground">未找到该代理</h2>
            <p>该代理可能已被移除，或当前链接参数无效。</p>
            <Button type="button" variant="outline" onClick={() => navigate("/agents")}>
              返回代理库
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        title={<DetailTitle currentLabel={agent.name} parentLabel="代理库" parentTo="/agents" />}
        contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
        headerRight={
          <div className="flex items-center gap-2">
            {isInstalledAgent ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={deleteLoading}
                onClick={() => setDeleteDialogOpen(true)}
              >
                {deleteLoading ? "删除中..." : "删除代理"}
              </Button>
            ) : null}
            <div className="flex h-8 items-center">
              <Switch checked={agent.enabled} label={`切换代理 ${agent.name}`} onChange={() => toggleAgent(agent.id)} />
            </div>
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-0 lg:flex-row">
          <aside className="w-full shrink-0 overflow-y-auto border-b border-border bg-app lg:w-[240px] lg:border-r lg:border-b-0">
            <div>
              {PRIMARY_FILES.map((path) => (
                <FileTreeButton key={path} active={selectedPath === path} label={path} onClick={() => handleSelectPath(path)} />
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

      {/* 删除代理确认 */}
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
            <AlertDialogTitle>删除代理</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除代理“{agent.name}”吗？该操作会移除当前已安装代理数据，且无法恢复。
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
              {deleteLoading ? "删除中..." : "删除代理"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 未保存切换确认 */}
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
