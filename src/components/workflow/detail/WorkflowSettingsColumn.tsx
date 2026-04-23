import { Grid2x2Plus, Link as LinkIcon, Save, Search } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { cn } from "../../../lib/utils";
import type { ResolvedAgent } from "../../../stores/subAgentStore";
import { WorkflowDetailSection } from "./WorkflowDetailSection";

type LoopDraft = {
  maxLoopsMode: "finite" | "infinite";
  maxLoopsValue: string;
};

type WorkspaceBindingSummary = {
  bookId: string;
  bookName: string;
  rootPath: string;
} | null;

type WorkflowSettingsColumnProps = {
  agentQuery: string;
  draftBasePrompt: string;
  draftName: string;
  draftWorkspaceBinding: WorkspaceBindingSummary;
  errorMessage: string | null;
  filteredAgents: ResolvedAgent[];
  hasSettingsDirty: boolean;
  isMobile: boolean;
  loopDraft: LoopDraft;
  memberBusy: string | null;
  onAddAgentStep: (agentId: string) => void;
  onAgentQueryChange: (value: string) => void;
  onDraftBasePromptChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
  onLoopModeChange: (value: LoopDraft["maxLoopsMode"]) => void;
  onLoopValueChange: (value: string) => void;
  onOpenBindingDialog: () => void;
  onSaveBasics: () => void;
  pageNotice: string | null;
  saveBusy: boolean;
  stepBusy: string | null;
};

export function WorkflowSettingsColumn({
  agentQuery,
  draftBasePrompt,
  draftName,
  draftWorkspaceBinding,
  errorMessage,
  filteredAgents,
  hasSettingsDirty,
  isMobile,
  loopDraft,
  memberBusy,
  onAddAgentStep,
  onAgentQueryChange,
  onDraftBasePromptChange,
  onDraftNameChange,
  onLoopModeChange,
  onLoopValueChange,
  onOpenBindingDialog,
  onSaveBasics,
  pageNotice,
  saveBusy,
  stepBusy,
}: WorkflowSettingsColumnProps) {
  return (
    <section className={cn("min-h-0 overflow-y-auto", isMobile ? "h-full" : "border-b border-border lg:border-r lg:border-b-0")}>
      <div className="divide-y divide-border">
        <WorkflowDetailSection
          title="基本设置"
          bodyClassName="space-y-4"
          actions={(
            <Button
              type="button"
              aria-label={saveBusy ? "基本设置保存中" : "保存基本设置"}
              title={
                saveBusy
                  ? "基本设置保存中 — 正在保存当前工作流的名称、绑定书籍和提示词"
                  : "保存基本设置 — 保存当前工作流的名称、绑定书籍和提示词"
              }
              size="icon-sm"
              variant="ghost"
              className={cn(
                "border-0 shadow-none hover:text-foreground",
                hasSettingsDirty
                  ? "bg-accent text-foreground hover:bg-accent/85"
                  : "bg-transparent text-muted-foreground hover:bg-transparent",
              )}
              onClick={onSaveBasics}
              disabled={!hasSettingsDirty || saveBusy}
            >
              <Save className="h-4 w-4" />
            </Button>
          )}
        >
          {pageNotice ? (
            <div className="editor-callout" data-tone="error">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">{pageNotice}</pre>
            </div>
          ) : null}
          {errorMessage ? (
            <div className="editor-callout" data-tone="error">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
            </div>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">工作流名称</span>
            <Input value={draftName} onChange={(event) => onDraftNameChange(event.target.value)} />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">绑定书籍</span>
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {draftWorkspaceBinding?.bookName ?? "尚未绑定书籍"}
                </p>
              </div>
              <Button
                type="button"
                aria-label={draftWorkspaceBinding ? "更换绑定书籍" : "绑定书籍"}
                title={
                  draftWorkspaceBinding
                    ? "更换绑定书籍 — 重新选择当前工作流绑定的书籍"
                    : "绑定书籍 — 为当前工作流关联一本书作为上下文"
                }
                variant="ghost"
                size="icon-sm"
                className="shrink-0 border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                onClick={onOpenBindingDialog}
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">循环配置</span>
            <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[120px_minmax(0,1fr)] md:items-end">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">最大循环次数</span>
                <Select value={loopDraft.maxLoopsMode} onValueChange={(value) => onLoopModeChange(value as LoopDraft["maxLoopsMode"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finite">有限</SelectItem>
                    <SelectItem value="infinite">无限</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {loopDraft.maxLoopsMode === "finite" ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">次数</span>
                  <Input
                    type="number"
                    min={1}
                    value={loopDraft.maxLoopsValue}
                    onChange={(event) => onLoopValueChange(event.target.value)}
                  />
                </label>
              ) : (
                <div className="flex h-10 items-center text-sm text-muted-foreground">无限</div>
              )}
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">提示词内容</span>
            <Textarea
              value={draftBasePrompt}
              onChange={(event) => onDraftBasePromptChange(event.target.value)}
              placeholder="补充这条工作流的全局目标、约束、写作风格与上下文。"
              className="min-h-32"
            />
          </label>
        </WorkflowDetailSection>

        <WorkflowDetailSection title="代理库" bodyClassName="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={agentQuery} onChange={(event) => onAgentQueryChange(event.target.value)} placeholder="搜索代理" className="pl-9" />
          </div>
          <div className="divide-y divide-border border-y border-border">
            {filteredAgents.map((agent) => (
              <div key={agent.id} className="flex items-start justify-between gap-3 px-0 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{agent.name}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{agent.description}</p>
                </div>
                {agent.validation.isValid ? (
                  <Button
                    type="button"
                    aria-label={`添加代理 ${agent.name}`}
                    title={`添加代理 ${agent.name} — 将该代理加入当前工作流`}
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                    onClick={() => onAddAgentStep(agent.id)}
                    disabled={stepBusy !== null || memberBusy !== null}
                  >
                    <Grid2x2Plus className="h-4 w-4" />
                  </Button>
                ) : (
                  <span className="inline-flex shrink-0 items-center px-0 py-1 text-[11px] font-medium text-amber-700">
                    待完善
                  </span>
                )}
              </div>
            ))}
          </div>
        </WorkflowDetailSection>
      </div>
    </section>
  );
}
