import { ArrowDown, ArrowUp, Bot, Flag, GitBranch, Play, Save, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { cn } from "../../../lib/utils";
import type { WorkflowDetail, WorkflowStepDefinition, WorkflowStepType } from "../../../lib/workflow/types";
import type { ResolvedAgent } from "../../../stores/subAgentStore";
import { WorkflowDetailSection } from "./WorkflowDetailSection";

const STEP_TYPE_OPTIONS: Array<{ label: string; value: WorkflowStepType }> = [
  { label: "开始节点", value: "start" },
  { label: "代理节点", value: "agent_task" },
  { label: "判断节点", value: "decision" },
  { label: "结束节点", value: "end" },
];

const END_REASON_OPTIONS = [
  { label: "完成", value: "completed" },
  { label: "审查失败", value: "review_failed" },
] as const;

const END_LOOP_OPTIONS = [
  { label: "直接结束", value: "finish" },
  { label: "有下一轮就继续", value: "continue_if_possible" },
] as const;

function StepTypeIcon({ type }: { type: WorkflowStepDefinition["type"] }) {
  if (type === "start") {
    return <Play aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  if (type === "agent_task") {
    return <Bot aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  if (type === "decision") {
    return <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  return <Flag aria-hidden="true" className="h-3.5 w-3.5" />;
}

type WorkflowBuilderColumnProps = {
  agents: ResolvedAgent[];
  detail: WorkflowDetail;
  formatStepLinks: (step: WorkflowStepDefinition, steps: WorkflowStepDefinition[]) => string;
  getStepAgentLabel: (step: WorkflowStepDefinition) => string;
  isMobile: boolean;
  isStepDraftDirty: boolean;
  onMoveStep: (stepId: string, direction: "up" | "down") => void;
  onRemoveStep: (stepId: string) => void;
  onSaveStepDraft: () => void;
  onSelectStep: (stepId: string) => void;
  onStepTypeChange: (nextType: WorkflowStepType) => void;
  onUpdateStepAgentId: (agentId: string) => void;
  onUpdateStepDraft: (step: WorkflowStepDefinition) => void;
  selectedStep: WorkflowStepDefinition | null;
  selectedStepId: string | null;
  stepBusy: string | null;
  stepDraft: WorkflowStepDefinition | null;
  stepDraftAgentId: string;
};

export function WorkflowBuilderColumn({
  agents,
  detail,
  formatStepLinks,
  getStepAgentLabel,
  isMobile,
  isStepDraftDirty,
  onMoveStep,
  onRemoveStep,
  onSaveStepDraft,
  onSelectStep,
  onStepTypeChange,
  onUpdateStepAgentId,
  onUpdateStepDraft,
  selectedStep,
  selectedStepId,
  stepBusy,
  stepDraft,
  stepDraftAgentId,
}: WorkflowBuilderColumnProps) {
  return (
    <section className={cn("min-h-0 overflow-y-auto", isMobile ? "h-full" : "border-b border-border lg:border-r lg:border-b-0")}>
      <div className="divide-y divide-border">
        <WorkflowDetailSection title="工作流" bodyClassName="p-0">
          <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
            {detail.steps.map((step, index) => (
              <article
                key={step.id}
                className={cn(
                  "editor-block-tile",
                  selectedStepId === step.id ? "bg-primary/[0.08]" : "",
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectStep(step.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectStep(step.id);
                    }
                  }}
                  className={cn(
                    "editor-block-content w-full cursor-pointer overflow-hidden rounded-none px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
                    selectedStepId === step.id ? "bg-primary/[0.04]" : "",
                  )}
                >
                  <div className="flex shrink-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
                      <span className="inline-flex items-center rounded-full border border-border bg-panel px-2 py-1">
                        <StepTypeIcon type={step.type} />
                        <span className="ml-1.5">{isMobile ? index + 1 : `节点 ${index + 1}`}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6.5 w-6.5 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                        disabled={index === 0 || stepBusy !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveStep(step.id, "up");
                        }}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6.5 w-6.5 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                        disabled={index === detail.steps.length - 1 || stepBusy !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveStep(step.id, "down");
                        }}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6.5 w-6.5 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveStep(step.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <p className="line-clamp-3 break-words text-[20px] font-semibold leading-[1.18] tracking-[-0.04em] text-foreground">
                      {step.name}
                    </p>
                  </div>
                  <div className="min-h-0 flex flex-1 flex-col justify-start border-t border-border/70 pt-3">
                    <div className="grid gap-2">
                      <div className="grid gap-0.5">
                        <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                          执行主体
                        </p>
                        <p className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground">
                          {getStepAgentLabel(step)}
                        </p>
                      </div>
                      <div className="grid gap-0.5">
                        <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                          消息
                        </p>
                        <p className="line-clamp-4 break-words text-xs leading-5 text-muted-foreground">
                          {formatStepLinks(step, detail.steps)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </WorkflowDetailSection>

        <WorkflowDetailSection
          title="节点编辑"
          bodyClassName="space-y-4"
          actions={
            selectedStep && stepDraft ? (
              <Button
                type="button"
                aria-label={stepBusy === selectedStep.id ? "节点保存中" : "保存当前节点"}
                size="icon-sm"
                variant="ghost"
                className={cn(
                  "border-0 shadow-none hover:text-foreground",
                  isStepDraftDirty
                    ? "bg-accent text-foreground hover:bg-accent/85"
                    : "bg-transparent text-muted-foreground hover:bg-transparent",
                )}
                onClick={onSaveStepDraft}
                disabled={!isStepDraftDirty || stepBusy === selectedStep.id}
              >
                <Save className="h-4 w-4" />
              </Button>
            ) : null
          }
        >
          {selectedStep && stepDraft ? (
            <div className="space-y-4">
              <p className="text-xs leading-5 text-muted-foreground">
                {isStepDraftDirty ? "当前有未保存的节点改动。点击右上角保存后才会写回工作流。" : "当前节点内容已保存。"}
              </p>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">节点类型</span>
                <Select value={stepDraft.type} onValueChange={(value) => onStepTypeChange(value as WorkflowStepType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STEP_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">节点名称</span>
                <Input
                  value={stepDraft.name}
                  onChange={(event) => onUpdateStepDraft({ ...stepDraft, name: event.target.value })}
                  disabled={stepBusy === selectedStep.id}
                />
              </label>

              {stepDraft.type === "start" ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">下一步</span>
                  <Select
                    value={stepDraft.nextStepId ?? "__none__"}
                    onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, nextStepId: value === "__none__" ? null : value })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">结束</SelectItem>
                      {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : null}

              {stepDraft.type === "agent_task" ? (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">代理</span>
                    <Select value={stepDraftAgentId} onValueChange={onUpdateStepAgentId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">输出模式</span>
                    <Select
                      value={stepDraft.outputMode}
                      onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, outputMode: value as typeof stepDraft.outputMode })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">文本</SelectItem>
                        <SelectItem value="review_json">审查 JSON</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">下一步</span>
                    <Select
                      value={stepDraft.nextStepId ?? "__none__"}
                      onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, nextStepId: value === "__none__" ? null : value })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">结束</SelectItem>
                        {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">节点提示词</span>
                    <Textarea
                      value={stepDraft.promptTemplate}
                      onChange={(event) => onUpdateStepDraft({ ...stepDraft, promptTemplate: event.target.value })}
                      className="min-h-40"
                      disabled={stepBusy === selectedStep.id}
                    />
                  </label>
                </>
              ) : null}

              {stepDraft.type === "decision" ? (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">判断代理</span>
                    <Select value={stepDraftAgentId} onValueChange={onUpdateStepAgentId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">判断来源</span>
                    <Select
                      value={stepDraft.sourceStepId || "__none__"}
                      onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, sourceStepId: value === "__none__" ? "" : value })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">未选择</SelectItem>
                        {detail.steps.filter((item) => item.id !== stepDraft.id && item.type === "agent_task").map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">通过/是 时</span>
                      <Select
                        value={stepDraft.trueNextStepId ?? "__none__"}
                        onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, trueNextStepId: value === "__none__" ? null : value })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">结束</SelectItem>
                          {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">不通过/否 时</span>
                      <Select
                        value={stepDraft.falseNextStepId ?? "__none__"}
                        onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, falseNextStepId: value === "__none__" ? null : value })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">结束</SelectItem>
                          {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">节点提示词</span>
                    <Textarea
                      value={stepDraft.promptTemplate}
                      onChange={(event) => onUpdateStepDraft({ ...stepDraft, promptTemplate: event.target.value })}
                      className="min-h-40"
                      disabled={stepBusy === selectedStep.id}
                    />
                  </label>
                </>
              ) : null}

              {stepDraft.type === "end" ? (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">结束原因</span>
                    <Select
                      value={stepDraft.stopReason}
                      onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, stopReason: value as typeof stepDraft.stopReason })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {END_REASON_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">结束后动作</span>
                    <Select
                      value={stepDraft.loopBehavior}
                      onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, loopBehavior: value as typeof stepDraft.loopBehavior })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {END_LOOP_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {stepDraft.loopBehavior === "continue_if_possible" ? (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">下一轮从哪个节点开始</span>
                      <Select
                        value={stepDraft.loopTargetStepId ?? "__none__"}
                        onValueChange={(value) => onUpdateStepDraft({ ...stepDraft, loopTargetStepId: value === "__none__" ? null : value })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">未选择</SelectItem>
                          {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : null}
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">结束摘要模板</span>
                    <Textarea
                      value={stepDraft.summaryTemplate}
                      onChange={(event) => onUpdateStepDraft({ ...stepDraft, summaryTemplate: event.target.value })}
                      className="min-h-32"
                      disabled={stepBusy === selectedStep.id}
                    />
                  </label>
                </>
              ) : null}
            </div>
          ) : (
            <div className="py-8 text-sm text-muted-foreground">
              先在上面选择一个节点，再补充它的连接方式和提示词。
            </div>
          )}
        </WorkflowDetailSection>
      </div>
    </section>
  );
}
