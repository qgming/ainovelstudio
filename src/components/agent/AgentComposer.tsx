import {
  AtSign,
  Check,
  Circle,
  Clock3,
  Maximize2,
  Minimize2,
  SendHorizontal,
  Square,
  SquareSlash,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { getBaseName } from "../../lib/bookWorkspace/paths";
import type { TreeNode } from "../../lib/bookWorkspace/types";
import type { ManualTurnContextSelection } from "../../lib/agent/manualTurnContext";
import type { PlanItem, PlanningState } from "../../lib/agent/planning";
import type { AgentRunStatus } from "../../lib/agent/types";
import { ActionMenu, type ActionMenuAnchorRect } from "../common/ActionMenu";
import { AgentManualResourcePicker } from "./AgentManualResourcePicker";
import { AgentWorkspaceFilePicker } from "./AgentWorkspaceFilePicker";

type SelectableResource = {
  description?: string;
  id: string;
  kind: "agent" | "skill";
  name: string;
};

type AgentComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (selection: ManualTurnContextSelection) => void;
  planningState: PlanningState;
  resources: SelectableResource[];
  rootNode: TreeNode | null;
  runStatus: AgentRunStatus;
};

function toAnchorRect(rect: DOMRect): ActionMenuAnchorRect {
  return {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  };
}

function removeValue(values: string[], value: string) {
  return values.filter((item) => item !== value);
}

function getPlanIcon(item: PlanItem) {
  if (item.status === "completed") {
    return <Check className="h-3.5 w-3.5" />;
  }
  if (item.status === "in_progress") {
    return <Clock3 className="h-3.5 w-3.5" />;
  }
  return <Circle className="h-3 w-3" />;
}

function countCompletedItems(items: PlanItem[]) {
  return items.filter((item) => item.status === "completed").length;
}

function hasIncompleteItems(items: PlanItem[]) {
  return items.some((item) => item.status !== "completed");
}

const COMPOSER_MIN_ROWS = 2;

export function AgentComposer({
  input,
  onInputChange,
  onStop,
  onSubmit,
  planningState,
  resources,
  rootNode,
  runStatus,
}: AgentComposerProps) {
  const isRunning = runStatus === "running";
  const showPlan = hasIncompleteItems(planningState.items);
  const hasStalePlan = planningState.roundsSinceUpdate >= 3;
  const completedCount = countCompletedItems(planningState.items);
  const [isPlanExpanded, setIsPlanExpanded] = useState(true);
  const [resourceAnchorRect, setResourceAnchorRect] =
    useState<ActionMenuAnchorRect | null>(null);
  const [fileAnchorRect, setFileAnchorRect] =
    useState<ActionMenuAnchorRect | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selection, setSelection] = useState<ManualTurnContextSelection>({
    agentIds: [],
    filePaths: [],
    skillIds: [],
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  const selectedItems = useMemo(() => {
    const resourceItems = resources
      .filter(
        (resource) =>
          selection.skillIds.includes(resource.id) ||
          selection.agentIds.includes(resource.id),
      )
      .map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        label: resource.name,
      }));
    const fileItems = selection.filePaths.map((path) => ({
      id: path,
      kind: "file" as const,
      label: getBaseName(path),
    }));
    return [...resourceItems, ...fileItems];
  }, [resources, selection.agentIds, selection.filePaths, selection.skillIds]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!isRunning && input.trim()) {
      onSubmit(selection);
      setSelection({ agentIds: [], filePaths: [], skillIds: [] });
    }
  };

  const handleResourceToggle = (resource: SelectableResource) => {
    setSelection((current) => {
      if (resource.kind === "skill") {
        return {
          ...current,
          skillIds: current.skillIds.includes(resource.id)
            ? removeValue(current.skillIds, resource.id)
            : [...current.skillIds, resource.id],
        };
      }

      return {
        ...current,
        agentIds: current.agentIds.includes(resource.id)
          ? removeValue(current.agentIds, resource.id)
          : [...current.agentIds, resource.id],
      };
    });
  };

  const handleFileToggle = (path: string) => {
    setSelection((current) => ({
      ...current,
      filePaths: current.filePaths.includes(path)
        ? removeValue(current.filePaths, path)
        : [...current.filePaths, path],
    }));
  };

  const handleRemoveSelected = (item: {
    id: string;
    kind: "agent" | "file" | "skill";
  }) => {
    setSelection((current) => {
      if (item.kind === "skill") {
        return { ...current, skillIds: removeValue(current.skillIds, item.id) };
      }
      if (item.kind === "agent") {
        return { ...current, agentIds: removeValue(current.agentIds, item.id) };
      }
      return { ...current, filePaths: removeValue(current.filePaths, item.id) };
    });
  };

  const handleSubmit = () => {
    onSubmit(selection);
    setSelection({ agentIds: [], filePaths: [], skillIds: [] });
  };

  return (
    <div className="bg-app">
      <ActionMenu
        anchorRect={resourceAnchorRect}
        maxHeight={680}
        onClose={() => setResourceAnchorRect(null)}
        width={220}
      >
        <AgentManualResourcePicker
          items={resources}
          onToggle={handleResourceToggle}
          selectedIds={[...selection.skillIds, ...selection.agentIds]}
        />
      </ActionMenu>
      <ActionMenu
        anchorRect={fileAnchorRect}
        maxHeight={760}
        onClose={() => setFileAnchorRect(null)}
        width={220}
      >
        <AgentWorkspaceFilePicker
          onToggleFile={handleFileToggle}
          rootNode={rootNode}
          selectedFilePaths={selection.filePaths}
        />
      </ActionMenu>

      {showPlan ? (
        <div className="bg-panel-subtle px-3 py-2">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="min-w-0 text-[12px] font-medium text-muted-foreground">
              共 {planningState.items.length} 个任务，已经完成 {completedCount}{" "}
              个
            </div>
            <Button
              type="button"
              aria-expanded={isPlanExpanded}
              aria-label={isPlanExpanded ? "收起待办计划" : "展开待办计划"}
              onClick={() => setIsPlanExpanded((current) => !current)}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
            >
              {isPlanExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
          {isPlanExpanded ? (
            <div className="max-h-[168px] overflow-y-auto pt-2 pr-1">
              <div className="pt-2">
                <div className="space-y-3">
                  {planningState.items.map((item, index) => (
                    <div
                      key={`${index}-${item.content}-${item.status}`}
                      className="flex items-start gap-3"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center ${
                          item.status === "completed"
                            ? "text-foreground"
                            : item.status === "in_progress"
                              ? "text-muted-foreground"
                              : "text-muted-foreground/70"
                        }`}
                      >
                        {getPlanIcon(item)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`break-words text-sm font-medium leading-6 ${
                            item.status === "completed"
                              ? "text-muted-foreground line-through decoration-muted-foreground/50"
                              : "text-foreground"
                          }`}
                        >
                          {index + 1}. {item.content}
                        </div>
                        {item.status === "in_progress" && item.activeForm ? (
                          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            {item.activeForm}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {hasStalePlan ? (
                  <div className="mt-3 rounded-md border border-border bg-panel px-3 py-2 text-xs leading-5 text-muted-foreground">
                    <span className="font-medium">{planningState.roundsSinceUpdate} 轮未更新</span>
                    ，连续几轮没有刷新计划，建议让 agent 同步一下最新进展。
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedItems.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 py-2">
          {selectedItems.map((item) => (
            <span
              key={`${item.kind}-${item.id}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
            >
              <span className="shrink-0">
                {item.kind === "file" ? "@" : "/"}
              </span>
              <span className="truncate">{item.label}</span>
              <Button
                type="button"
                aria-label={`移除 ${item.label}`}
                onClick={() => handleRemoveSelected(item)}
                variant="ghost"
                size="icon-xs"
                className="h-4 w-4 text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </Button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden border-t border-border">
        <textarea
          ref={textareaRef}
          aria-label="Agent 输入框"
          className="editor-textarea px-3 py-3 leading-6"
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入新想法"
          rows={COMPOSER_MIN_ROWS}
          value={input}
        />
        <div className="flex h-11 items-center gap-2 border-t border-border px-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <Button
              type="button"
              aria-label="选择技能或子 Agent"
              disabled={isRunning}
              onClick={(event) => {
                const nextAnchorRect = toAnchorRect(
                  event.currentTarget.getBoundingClientRect(),
                );
                setFileAnchorRect(null);
                setResourceAnchorRect((current) =>
                  current ? null : nextAnchorRect,
                );
              }}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
            >
              <SquareSlash className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              aria-label="选择工作区文件"
              disabled={isRunning}
              onClick={(event) => {
                const nextAnchorRect = toAnchorRect(
                  event.currentTarget.getBoundingClientRect(),
                );
                setResourceAnchorRect(null);
                setFileAnchorRect((current) =>
                  current ? null : nextAnchorRect,
                );
              }}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
            >
              <AtSign className="h-4 w-4" />
            </Button>
          </div>
          <div
            aria-hidden="true"
            className="h-6 w-px shrink-0 bg-border"
          />
          <Button
            type="button"
            aria-label={isRunning ? "停止输出" : "发送消息"}
            onClick={isRunning ? onStop : handleSubmit}
            disabled={!isRunning && !input.trim()}
            variant={isRunning ? "secondary" : "default"}
            size="icon-sm"
            className={
              isRunning
                ? "h-7 w-7 rounded-full"
                : "h-7 w-7 rounded-full border-transparent bg-foreground text-background hover:bg-foreground/88"
            }
          >
            {isRunning ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <SendHorizontal className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
