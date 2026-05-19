import {
  AtSign,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  ListChecks,
  LucideIcon,
  Maximize2,
  Minimize2,
  SendHorizontal,
  Sparkles,
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
import { Button } from "@shared/ui/button";
import { Input } from "@shared/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { cn } from "@shared/utils";
import type { AgentMode } from "@features/agent/lib/modeRules";
import { getBaseName } from "@features/books/lib/paths";
import type { TreeNode } from "@features/books/types";
import type { ManualTurnContextSelection } from "@features/agent/lib/manualTurnContext";
import type { PlanItem, PlanningState } from "@features/agent/lib/planning";
import type { AgentRunStatus, AskToolAnswer } from "@features/agent/lib/types";
import type { PendingAskState } from "@features/agent/stores/chat-run/helpers";
import { AgentManualResourcePicker } from "./AgentManualResourcePicker";
import { AgentWorkspaceFilePicker } from "./AgentWorkspaceFilePicker";

type SelectableResource = {
  description?: string;
  id: string;
  kind: "skill";
  name: string;
};

export type AgentComposerMode = {
  description: string;
  icon: LucideIcon;
  id: AgentMode;
  label: string;
};

type AgentComposerProps = {
  activeModeId?: AgentMode;
  input: string;
  modes?: AgentComposerMode[];
  onCoach: () => Promise<void>;
  onFollowUp?: (selection: ManualTurnContextSelection) => void;
  onInputChange: (value: string) => void;
  onModeChange?: (modeId: AgentMode) => void;
  onSelectionChange?: (selection: ManualTurnContextSelection) => void;
  onStop: () => void;
  onSubmit: (selection: ManualTurnContextSelection) => void;
  onSubmitAskAnswer: (answer: AskToolAnswer) => void;
  pendingAsk: PendingAskState | null;
  planningState: PlanningState;
  queuedFollowUpMessages?: string[];
  queuedSteeringMessages?: string[];
  resources: SelectableResource[];
  rootNode: TreeNode | null;
  runStatus: AgentRunStatus;
  selection?: ManualTurnContextSelection;
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
const COMPOSER_MAX_HEIGHT_PX = 240;
const DEFAULT_COMPOSER_MODE_ID: AgentMode = "book";
const MODE_INPUT_PLACEHOLDERS: Record<AgentMode, string> = {
  autopilot: "输入全自动目标：YOLO 会循环执行、验证和回写，直到目标完成",
  "book-design": "输入立项目标、平台、题材偏好或卖点方向",
  book: "输入想法、问题或要处理的任务",
  "chapter-write": "输入要规划、续写或生产的章节目标",
  "continuity-review": "输入要检查的章节、人物、伏笔或时间线问题",
  "state-maintain": "输入要抽取和回写的章节状态变化",
  "style-polish": "输入要润色、统一文风或去 AI 味的章节",
  "volume-plan": "输入要规划的卷、阶段冲突或升级节奏",
};

export const DEFAULT_AGENT_COMPOSER_MODES: AgentComposerMode[] = [
  {
    description: "默认对话与任务执行模式",
    icon: Sparkles,
    id: DEFAULT_COMPOSER_MODE_ID,
    label: "协作",
  },
  {
    description: "按目标全自动读取、执行、验证和回写",
    icon: Zap,
    id: "autopilot",
    label: "YOLO",
  },
];

export function AgentComposer({
  activeModeId,
  input,
  modes = DEFAULT_AGENT_COMPOSER_MODES,
  onCoach,
  onFollowUp,
  onInputChange,
  onModeChange,
  onSelectionChange,
  onStop,
  onSubmit,
  onSubmitAskAnswer,
  pendingAsk,
  planningState,
  queuedFollowUpMessages = [],
  queuedSteeringMessages = [],
  resources,
  rootNode,
  runStatus,
  selection: controlledSelection,
}: AgentComposerProps) {
  const isRunning = runStatus === "running";
  const isAskMode = Boolean(pendingAsk);
  const [isCoaching, setIsCoaching] = useState(false);
  const [localModeId, setLocalModeId] = useState(activeModeId ?? modes[0]?.id ?? DEFAULT_COMPOSER_MODE_ID);
  const showPlan = hasIncompleteItems(planningState.items);
  const hasStalePlan = planningState.roundsSinceUpdate >= 3;
  const completedCount = countCompletedItems(planningState.items);
  const [isPlanExpanded, setIsPlanExpanded] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [localSelection, setLocalSelection] = useState<ManualTurnContextSelection>({
    filePaths: [],
    skillIds: [],
  });
  const selection = controlledSelection ?? localSelection;
  const [askSelectedIds, setAskSelectedIds] = useState<string[]>([]);
  const [askCustomInput, setAskCustomInput] = useState("");
  const askRequest = pendingAsk?.request ?? null;
  const selectedModeId = activeModeId ?? localModeId;
  const activeMode = modes.find((mode) => mode.id === selectedModeId) ?? modes[0] ?? DEFAULT_AGENT_COMPOSER_MODES[0];
  const ActiveModeIcon = activeMode.icon;
  const inputPlaceholder = MODE_INPUT_PLACEHOLDERS[activeMode.id];
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
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
          selection.skillIds.includes(resource.id),
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
  }, [resources, selection.filePaths, selection.skillIds]);

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
    if (!isAskMode && input.trim()) {
      if (event.altKey && isRunning && onFollowUp) {
        onFollowUp(selection);
        return;
      }
      onSubmit(selection);
      if (!isRunning) {
        updateSelection(() => ({ filePaths: [], skillIds: [] }));
      }
    }
  };

  const updateSelection = (
    updater: (current: ManualTurnContextSelection) => ManualTurnContextSelection,
  ) => {
    const nextSelection = updater(selection);
    if (controlledSelection === undefined) {
      setLocalSelection(nextSelection);
    }
    onSelectionChange?.(nextSelection);
  };

  const handleResourceToggle = (resource: SelectableResource) => {
    updateSelection((current) => {
      return {
        ...current,
        skillIds: current.skillIds.includes(resource.id)
          ? removeValue(current.skillIds, resource.id)
          : [...current.skillIds, resource.id],
      };
    });
  };

  const handleFileToggle = (path: string) => {
    updateSelection((current) => ({
      ...current,
      filePaths: current.filePaths.includes(path)
        ? removeValue(current.filePaths, path)
        : [...current.filePaths, path],
    }));
  };

  const handleRemoveSelected = (item: {
    id: string;
    kind: "file" | "skill";
  }) => {
    updateSelection((current) => {
      if (item.kind === "skill") {
        return { ...current, skillIds: removeValue(current.skillIds, item.id) };
      }
      return { ...current, filePaths: removeValue(current.filePaths, item.id) };
    });
  };

  const handleSubmit = () => {
    onSubmit(selection);
    updateSelection(() => ({ filePaths: [], skillIds: [] }));
  };

  const handleModeSelect = (modeId: AgentMode) => {
    setLocalModeId(modeId);
    onModeChange?.(modeId);
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
    <div className="bg-card text-card-foreground dark:bg-panel">
      {showPlan ? (
        <div className={cn("border-t border-border bg-panel-subtle px-3", isPlanExpanded ? "py-2" : "py-1")}>
          <div className={cn("flex items-center justify-between gap-3", isPlanExpanded ? "min-h-8" : "min-h-7")}>
            <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
              <ListChecks aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">
                共 {planningState.items.length} 个任务，已经完成 {completedCount}{" "}
                个
              </span>
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
          <div className="flex h-[340px] flex-col">
            <div className="shrink-0 space-y-1 border-b border-border px-3 py-3">
              <div className="text-sm font-medium text-foreground">{askRequest.title}</div>
              {askRequest.description ? (
                <div className="text-xs leading-5 text-muted-foreground">
                  {askRequest.description}
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
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
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-3 dark:bg-panel">
              <div className="min-w-0 truncate text-xs text-muted-foreground">
                {askRequest.selectionMode === "single"
                  ? "请选择一项后确认"
                  : `可多选${Number.isFinite(askMaxSelections) ? `，最多 ${askMaxSelections} 项` : ""}`}
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
              className="editor-textarea overscroll-contain px-3 py-3 leading-6"
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              rows={COMPOSER_MIN_ROWS}
              style={{ maxHeight: COMPOSER_MAX_HEIGHT_PX }}
              value={input}
            />
            <div className="flex h-11 items-center gap-2 border-t border-border px-2">
              <div className="flex min-w-0 flex-1 items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      aria-label="选择技能"
                      title="选择技能 — 为本次消息附加技能上下文"
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
                      selectedIds={selection.skillIds}
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
                title="鞭策 — 催促 AI 从当前断点继续执行"
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    aria-label={`当前模式：${activeMode.label}`}
                    title={`${activeMode.label} — ${activeMode.description}`}
                    disabled={isRunning}
                    variant="outline"
                    size="sm"
                    className="h-7 max-w-[8.5rem] gap-1.5 rounded-full px-2 text-xs text-foreground"
                  >
                    <ActiveModeIcon className="size-3.5" />
                    <span className="truncate">{activeMode.label}</span>
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-48">
                  {modes.map((mode) => {
                    const ModeIcon = mode.icon;
                    const selected = mode.id === activeMode.id;
                    return (
                      <DropdownMenuItem
                        key={mode.id}
                        onSelect={() => handleModeSelect(mode.id)}
                        className="items-start gap-2 py-2"
                      >
                        <ModeIcon className="mt-0.5 size-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{mode.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {mode.description}
                          </span>
                        </span>
                        {selected ? <Check className="mt-0.5 size-4" /> : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
	              <div aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
              {queuedSteeringMessages.length > 0 ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  纠偏 {queuedSteeringMessages.length}
                </span>
              ) : null}
              {queuedFollowUpMessages.length > 0 ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  续跑 {queuedFollowUpMessages.length}
                </span>
              ) : null}
	              {isRunning ? (
	                <>
	                  <Button
	                    type="button"
	                    aria-label="发送纠偏"
	                    title="发送纠偏 — 插入到当前工具结果之后继续执行"
	                    onClick={handleSubmit}
	                    disabled={!input.trim()}
	                    variant="default"
	                    size="icon-sm"
	                    className="h-7 w-7 rounded-full border-transparent bg-foreground text-background hover:bg-foreground/88"
	                  >
	                    <SendHorizontal className="h-3.5 w-3.5" />
	                  </Button>
	                  <Button
	                    type="button"
	                    aria-label="停止输出"
	                    title="停止输出 — 终止当前输出并保留已生成内容"
	                    onClick={onStop}
	                    variant="secondary"
	                    size="icon-sm"
	                    className="h-7 w-7 rounded-full"
	                  >
	                    <Square className="h-3.5 w-3.5 fill-current" />
	                  </Button>
	                </>
	              ) : (
	                <Button
	                  type="button"
	                  aria-label="发送消息"
	                  title="发送消息 — 将当前输入发送给 agent 开始处理"
	                  onClick={handleSubmit}
	                  disabled={!input.trim()}
	                  variant="default"
	                  size="icon-sm"
	                  className="h-7 w-7 rounded-full border-transparent bg-foreground text-background hover:bg-foreground/88"
	                >
	                  <SendHorizontal className="h-3.5 w-3.5" />
	                </Button>
	              )}
	            </div>
          </>
        )}
      </div>
    </div>
  );
}
