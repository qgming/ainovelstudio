import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Eraser,
  GitBranch,
  Pencil,
  PenLine,
  RefreshCcw,
  TextSearch,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { AgentPartRenderer } from "../../agent/AgentPartRenderer";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { WorkflowDetailSection } from "../../workflow/detail/WorkflowDetailSection";
import type { AgentPart, AgentRunStatus } from "../../../lib/agent/types";

export type ExpansionWorkspaceActionId =
  | "project-batch-outline"
  | "project-batch-settings"
  | "setting-update"
  | "chapter-write"
  | "chapter-setting-update"
  | "free-input";

export type ExpansionWorkspaceTask = {
  actionId: ExpansionWorkspaceActionId;
  actionLabel: string;
  createdAt: number;
  description: string;
  statusLabel: string;
  targetLabel: string;
};

export type ExpansionWorkspaceActionButton = {
  description: string;
  id: ExpansionWorkspaceActionId;
  label: string;
  onClick: () => void;
  onEditTemplate?: () => void;
  templateCustomized?: boolean;
};

type ExpansionWorkspacePanelProps = {
  activeTask: ExpansionWorkspaceTask | null;
  agentParts: AgentPart[];
  availableActions: ExpansionWorkspaceActionButton[];
  currentFileName: string | null;
  executionPrompt: string;
  isMobile?: boolean;
  onClearLogs: () => void;
  runStatus: AgentRunStatus;
  targetLabel: string | null;
};

type WorkspaceActionButtonProps = {
  active?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  onEditTemplate?: () => void;
  templateCustomized?: boolean;
};

function getActionIcon(actionId: ExpansionWorkspaceActionId): ComponentType<{ className?: string }> {
  if (actionId === "project-batch-outline") {
    return GitBranch;
  }
  if (actionId === "project-batch-settings") {
    return Boxes;
  }
  if (actionId === "setting-update") {
    return RefreshCcw;
  }
  if (actionId === "chapter-write") {
    return PenLine;
  }
  if (actionId === "free-input") {
    return PenLine;
  }
  return TextSearch;
}

function WorkspaceActionButton({
  active = false,
  icon: Icon,
  label,
  onClick,
  onEditTemplate,
  templateCustomized = false,
}: WorkspaceActionButtonProps) {
  return (
    <div className="flex items-stretch gap-1.5">
      <Button
        type="button"
        variant={active ? "default" : "outline"}
        onClick={onClick}
        className={cn(
          "h-10 flex-1 justify-start gap-2 rounded-md px-3 text-sm",
          active ? "shadow-none" : "bg-background/80",
        )}
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </Button>
      {onEditTemplate ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onEditTemplate}
          aria-label={`编辑「${label}」提示词模板`}
          title={
            templateCustomized
              ? `编辑「${label}」提示词模板（已自定义）`
              : `编辑「${label}」提示词模板`
          }
          className={cn(
            "relative h-10 w-10 shrink-0 rounded-md bg-background/80 text-muted-foreground hover:text-foreground",
            templateCustomized && "text-amber-600 hover:text-amber-700",
          )}
        >
          <Pencil className="h-4 w-4" />
          {templateCustomized ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
            />
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}

export function ExpansionWorkspacePanel({
  activeTask,
  agentParts,
  availableActions,
  currentFileName,
  executionPrompt,
  isMobile = false,
  onClearLogs,
  runStatus,
  targetLabel,
}: ExpansionWorkspacePanelProps) {
  const [isPromptExpanded, setIsPromptExpanded] = useState(true);

  return (
    <aside
      className={cn(
        "w-full shrink-0 border-t border-border bg-app lg:min-h-0 lg:w-[340px] lg:border-t-0 lg:border-l",
        isMobile ? "h-auto min-h-0 overflow-visible" : "h-full min-h-[360px] overflow-y-auto",
      )}
    >
      <div className="flex flex-col">
        <WorkflowDetailSection
          title="工作区操作"
          actions={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              aria-label="清空操作日志"
              title="清空操作日志"
              onClick={onClearLogs}
            >
              <Eraser className="h-4 w-4" />
            </Button>
          }
          bodyClassName="space-y-4 p-0"
        >
          <div className="border-b border-border px-3 py-3">
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                正在打开
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {currentFileName ?? "未选择文件"}
              </p>
            </div>
          </div>

          <div className="space-y-3 px-3 pb-3">
            {availableActions.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {availableActions.map((action) => {
                  const Icon = getActionIcon(action.id);
                  return (
                    <WorkspaceActionButton
                      key={action.id}
                      active={activeTask?.actionId === action.id}
                      icon={Icon}
                      label={action.label}
                      onClick={action.onClick}
                      onEditTemplate={action.onEditTemplate}
                      templateCustomized={action.templateCustomized}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                先在左侧选择一个项目文件、设定文件或章节文件，再从这里触发对应操作。
              </p>
            )}
          </div>
        </WorkflowDetailSection>

        <WorkflowDetailSection title="AI 执行步骤" className="border-t border-border" bodyClassName="px-0 py-0">
          <div className="space-y-4 px-3 py-3">
            {executionPrompt ? (
              <section className="border-b border-border pb-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">输入提示词</p>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={isPromptExpanded ? "收起输入提示词" : "展开输入提示词"}
                    title={isPromptExpanded ? "收起输入提示词" : "展开输入提示词"}
                    onClick={() => setIsPromptExpanded((value) => !value)}
                  >
                    {isPromptExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className={cn("mt-2 overflow-hidden", isPromptExpanded ? "" : "max-h-[8rem]")}>
                  <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
                    {executionPrompt}
                  </pre>
                </div>
              </section>
            ) : null}

            {agentParts.length > 0 ? (
              <div className="space-y-3">
                {agentParts.map((part, index) => (
                  <AgentPartRenderer key={`expansion-agent-part-${index}`} part={part} />
                ))}
              </div>
            ) : runStatus === "running" ? (
              <div className="space-y-3">
                <AgentPartRenderer part={{ type: "placeholder", text: "正在思考" }} />
              </div>
            ) : activeTask ? (
              <div className="py-6 text-sm text-muted-foreground">
                {`正在执行 ${activeTask.actionLabel}，目标：${activeTask.targetLabel ?? targetLabel ?? "尚未锁定目标"}`}
              </div>
            ) : (
              <div className="min-h-12" aria-hidden="true" />
            )}
          </div>
        </WorkflowDetailSection>
      </div>
    </aside>
  );
}
