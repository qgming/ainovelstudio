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
  Zap,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getBaseName } from "../../lib/bookWorkspace/paths";
import type { TreeNode } from "../../lib/bookWorkspace/types";
import type { ManualTurnContextSelection } from "../../lib/agent/manualTurnContext";
import type { PlanItem, PlanningState } from "../../lib/agent/planning";
import type { AgentRunStatus, AskToolAnswer } from "../../lib/agent/types";
import type { PendingAskState } from "../../stores/chatRun/helpers";
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
  onCoach: () => Promise<void>;
  onInputChange: (value: string) => void;
  onStop: () => void;
  onSubmit: (selection: ManualTurnContextSelection) => void;
  onSubmitAskAnswer: (answer: AskToolAnswer) => void;
  pendingAsk: PendingAskState | null;
  planningState: PlanningState;
  resources: SelectableResource[];
  rootNode: TreeNode | null;
  runStatus: AgentRunStatus;
};

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

function buildInitialAskSelection(_pendingAsk: PendingAskState | null) {
  return {
    customInput: "",
    selectedIds: [] as string[],
  };
}

const COMPOSER_MIN_ROWS = 2;

export function AgentComposer({
  input,
  onCoach,
  onInputChange,
  onStop,
  onSubmit,
  onSubmitAskAnswer,
  pendingAsk,
  planningState,
  resources,
  rootNode,
  runStatus,
}: AgentComposerProps) {
  const isRunning = runStatus === "running";
  const isAskMode = Boolean(pendingAsk);
  const [isCoaching, setIsCoaching] = useState(false);
  const showPlan = hasIncompleteItems(planningState.items);
  const hasStalePlan = planningState.roundsSinceUpdate >= 3;
  const completedCount = countCompletedItems(planningState.items);
  const [isPlanExpanded, setIsPlanExpanded] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selection, setSelection] = useState<ManualTurnContextSelection>({
    agentIds: [],
    filePaths: [],
    skillIds: [],
  });
  const [askSelectedIds, setAskSelectedIds] = useState<string[]>([]);
  const [askCustomInput, setAskCustomInput] = useState("");
  const askRequest = pendingAsk?.request ?? null;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    const nextState = buildInitialAskSelection(pendingAsk);
    setAskSelectedIds(nextState.selectedIds);
    setAskCustomInput(nextState.customInput);
  }, [pendingAsk]);

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

  const askUsesCustomInput = Boolean(
    askRequest && askSelectedIds.includes(askRequest.customOptionId),
  );
  const askMinSelections = askRequest?.minSelections ?? 1;
  const askMaxSelections = askRequest?.maxSelections ?? (askRequest?.selectionMode === "single" ? 1 : Number.POSITIVE_INFINITY);
  const askHasValidSelectionCount =
    askSelectedIds.length >= askMinSelections && askSelectedIds.length <= askMaxSelections;
  const askCanSubmit =
    Boolean(askRequest)
    && askHasValidSelectionCount
    && (!askUsesCustomInput || Boolean(askCustomInput.trim()));

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!isRunning && !isAskMode && input.trim()) {
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

  const handleAskToggle = (optionId: string) => {
    if (!askRequest) {
      return;
    }

    if (askRequest.selectionMode === "single") {
      setAskSelectedIds([optionId]);
      if (optionId !== askRequest.customOptionId) {
        setAskCustomInput("");
      }
      return;
    }

    setAskSelectedIds((current) => {
      if (current.includes(optionId)) {
        if (optionId === askRequest.customOptionId) {
          setAskCustomInput("");
        }
        return removeValue(current, optionId);
      }
      if (current.length >= askMaxSelections) {
        return current;
      }
      return [...current, optionId];
    });
  };

  const handleAskSubmit = () => {
    if (!askRequest || !askCanSubmit) {
      return;
    }

    const values = askSelectedIds
      .map((optionId) => {
        const option = askRequest.options.find((item) => item.id === optionId);
        if (!option) {
          return null;
        }
        if (optionId === askRequest.customOptionId) {
          return {
            type: "custom" as const,
            id: option.id,
            label: option.label,
            value: askCustomInput.trim(),
          };
        }
        return {
          type: "option" as const,
          id: option.id,
          label: option.label,
          value: option.label,
        };
      })
      .filter((value): value is AskToolAnswer["values"][number] => value !== null);

    onSubmitAskAnswer({
      selectionMode: askRequest.selectionMode,
      values,
      usedCustomInput: askUsesCustomInput,
      customInput: askUsesCustomInput ? askCustomInput.trim() : undefined,
    });
  };

  return (
    <div className="bg-app">
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
              title={
                isPlanExpanded
                  ? "收起待办计划 — 收起 agent 当前拆分出的执行步骤"
                  : "展开待办计划 — 查看 agent 当前拆分出的执行步骤"
              }
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
                    <span className="font-medium">
                      {planningState.roundsSinceUpdate} 轮未更新
                    </span>
                    ，连续几轮没有刷新计划，建议让 agent 同步一下最新进展。
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isAskMode && selectedItems.length > 0 ? (
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
                title={`移除 ${item.label} — 从本次消息上下文中移除这项内容`}
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
        {isAskMode && askRequest ? (
          <div>
            <div className="space-y-1 px-3 py-3">
              <div className="text-sm font-medium text-foreground">{askRequest.title}</div>
              {askRequest.description ? (
                <div className="text-xs leading-5 text-muted-foreground">
                  {askRequest.description}
                </div>
              ) : null}
            </div>
            <div className="divide-y divide-border border-y border-border">
              {askRequest.options.map((option) => {
                const selected = askSelectedIds.includes(option.id);
                const isCustomOption = option.id === askRequest.customOptionId;
                const isSingleSelect = askRequest.selectionMode === "single";
                return (
                  <div
                    key={option.id}
                    className={cn(
                      "transition-colors",
                      selected ? "bg-panel-subtle" : "bg-transparent hover:bg-accent/30",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleAskToggle(option.id)}
                      className="flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left text-foreground transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center border transition-colors",
                          isSingleSelect ? "rounded-full" : "rounded-[0.375rem]",
                          selected
                            ? "border-foreground bg-foreground text-background"
                            : "border-muted-foreground/40 bg-background text-transparent",
                        )}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn(
                          "block text-sm leading-6",
                          selected ? "font-medium text-foreground" : "font-normal text-foreground",
                        )}
                        >
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="block text-xs leading-5 text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {isCustomOption && selected ? (
                      <div className="border-t border-border/70 px-3 pb-3 pl-11 pt-3">
                        <Input
                          aria-label="用户输入"
                          className="h-9 border-border bg-background"
                          placeholder={askRequest.customPlaceholder ?? "请输入内容"}
                          value={askCustomInput}
                          onChange={(event) => setAskCustomInput(event.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="text-xs text-muted-foreground">
                {askRequest.selectionMode === "single"
                  ? "请选择一项后确认"
                  : `可多选${Number.isFinite(askMaxSelections) ? `，最多 ${askMaxSelections} 项` : ""}`}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onStop}>
                  终止
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAskSubmit}
                  disabled={!askCanSubmit}
                >
                  {askRequest.confirmLabel ?? "确认"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      aria-label="选择技能或子 Agent"
                      title="选择技能或子 Agent — 为本次消息附加技能或委派对象"
                      disabled={isRunning}
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                    >
                      <SquareSlash className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    sideOffset={6}
                    className="max-h-[60vh] w-56 overflow-y-auto p-1"
                  >
                    <AgentManualResourcePicker
                      items={resources}
                      onToggle={handleResourceToggle}
                      selectedIds={[...selection.skillIds, ...selection.agentIds]}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      aria-label="选择工作区文件"
                      title="选择工作区文件 — 将工作区文件作为本次消息的上下文"
                      disabled={isRunning}
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                    >
                      <AtSign className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    sideOffset={6}
                    className="max-h-[60vh] w-56 overflow-y-auto p-1"
                  >
                    <AgentWorkspaceFilePicker
                      onToggleFile={handleFileToggle}
                      rootNode={rootNode}
                      selectedFilePaths={selection.filePaths}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button
                type="button"
                aria-label="鞭策"
                title="鞭策 — 终止当前活动并催促 AI 回到正轨"
                disabled={isCoaching}
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => {
                  setIsCoaching(true);
                  void onCoach().finally(() => setIsCoaching(false));
                }}
              >
                <Zap className="size-5" />
              </Button>
              <div aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
              <Button
                type="button"
                aria-label={isRunning ? "停止输出" : "发送消息"}
                title={
                  isRunning
                    ? "停止输出 — 终止当前输出并保留已生成内容"
                    : "发送消息 — 将当前输入发送给 agent 开始处理"
                }
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
          </>
        )}
      </div>
    </div>
  );
}
