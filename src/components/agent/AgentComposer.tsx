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
import { useMemo, useState, type KeyboardEvent } from "react";
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
  const [selection, setSelection] = useState<ManualTurnContextSelection>({
    agentIds: [],
    filePaths: [],
    skillIds: [],
  });

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
    <div className="border-t border-[#e2e8f0] bg-[#f7f7f8] dark:border-[#20242b] dark:bg-[#111214]">
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
        <div className="border-b border-[#e7edf5] px-3 py-1 dark:border-[#232833]">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="min-w-0 text-[13px] font-medium text-[#526074] dark:text-[#98a4b6]">
              共 {planningState.items.length} 个任务，已经完成 {completedCount}{" "}
              个
            </div>
            <button
              type="button"
              aria-expanded={isPlanExpanded}
              aria-label={isPlanExpanded ? "收起待办计划" : "展开待办计划"}
              onClick={() => setIsPlanExpanded((current) => !current)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#7b8798] transition hover:bg-[#eef2f7] hover:text-[#111827] dark:text-[#8b97a8] dark:hover:bg-[#171b22] dark:hover:text-white"
            >
              {isPlanExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </div>
          {isPlanExpanded ? (
            <div className="max-h-[168px] overflow-y-auto pt-2 pr-1 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin] dark:[scrollbar-color:#2f3540_transparent]">
              <div className="border-t border-[#e7edf5] pt-2 dark:border-[#232833]">
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
                            ? "text-[#111827] dark:text-[#f3f4f6]"
                            : item.status === "in_progress"
                              ? "text-[#526074] dark:text-[#98a4b6]"
                              : "text-[#9aa4b2] dark:text-[#657184]"
                        }`}
                      >
                        {getPlanIcon(item)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`break-words text-sm font-medium leading-6 ${
                            item.status === "completed"
                              ? "text-[#7b8798] line-through decoration-[#aeb8c5] dark:text-[#657184] dark:decoration-[#4b5563]"
                              : "text-[#1f2937] dark:text-[#eef2f7]"
                          }`}
                        >
                          {index + 1}. {item.content}
                        </div>
                        {item.status === "in_progress" && item.activeForm ? (
                          <div className="mt-0.5 text-xs leading-5 text-[#7b8798] dark:text-[#657184]">
                            {item.activeForm}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {hasStalePlan ? (
                  <div className="mt-3 rounded-[10px] border border-[#e7edf5] bg-[#f3f6fb] px-3 py-2 text-xs leading-5 text-[#526074] dark:border-[#232833] dark:bg-[#161b22] dark:text-[#98a4b6]">
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
        <div className="flex flex-wrap gap-2 border-b border-[#e7edf5] px-3 py-2 dark:border-[#232833]">
          {selectedItems.map((item) => (
            <span
              key={`${item.kind}-${item.id}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#dbe4f0] px-2.5 py-1 text-xs font-medium text-[#526074] dark:border-[#2a3039] dark:text-[#98a4b6]"
            >
              <span className="shrink-0">
                {item.kind === "file" ? "@" : "/"}
              </span>
              <span className="truncate">{item.label}</span>
              <button
                type="button"
                aria-label={`移除 ${item.label}`}
                onClick={() => handleRemoveSelected(item)}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#7b8798] transition hover:bg-[#eef2f7] hover:text-[#111827] dark:text-[#8b97a8] dark:hover:bg-[#171b22] dark:hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden">
        <textarea
          aria-label="Agent 输入框"
          className="min-h-[96px] w-full resize-none border-none bg-transparent px-3 py-3 text-sm leading-6 text-[#1f2937] outline-none placeholder:text-[#8c97a8] dark:text-[#eef2f7] dark:placeholder:text-[#5f6b7d]"
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="让 agent 读取当前章节、调用技能和工具完成创作任务..."
          value={input}
        />
        <div className="flex items-center gap-3 border-t border-[#e7edf5] px-3 py-2 dark:border-[#232833]">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#526074] transition hover:bg-[#eef2f7] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#98a4b6] dark:hover:bg-[#171b22] dark:hover:text-white"
            >
              <SquareSlash className="h-4 w-4" />
            </button>
            <button
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#526074] transition hover:bg-[#eef2f7] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#98a4b6] dark:hover:bg-[#171b22] dark:hover:text-white"
            >
              <AtSign className="h-4 w-4" />
            </button>
            <span className="truncate text-[11px] text-[#7b8798] dark:text-[#657184]">
              Enter 发送，Shift + Enter 换行
            </span>
          </div>
          <div
            aria-hidden="true"
            className="h-8 w-px shrink-0 bg-[#e3e9f2] dark:bg-[#2a3039]"
          />
          <button
            type="button"
            aria-label={isRunning ? "停止输出" : "发送消息"}
            onClick={isRunning ? onStop : handleSubmit}
            disabled={!isRunning && !input.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111827] text-white transition hover:bg-[#0b1220] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
          >
            {isRunning ? (
              <Square className="h-4 w-4 fill-current" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
