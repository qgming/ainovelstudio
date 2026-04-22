import { Check, ChevronDown, ChevronUp, Circle, LoaderCircle, X } from "lucide-react";
import { AgentPartRenderer } from "../../agent/AgentPartRenderer";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import type { WorkflowDetail, WorkflowStepRun } from "../../../lib/workflow/types";
import { WorkflowDetailSection } from "./WorkflowDetailSection";

function StepRunStatusIcon({ status }: { status: WorkflowStepRun["status"] }) {
  if (status === "running") {
    return <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-amber-600" />;
  }
  if (status === "completed") {
    return <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />;
  }
  if (status === "failed") {
    return <X aria-hidden="true" className="h-3.5 w-3.5 text-destructive" />;
  }
  return <Circle aria-hidden="true" className="h-3 w-3 text-muted-foreground" />;
}

type WorkflowRunsColumnProps = {
  detail: WorkflowDetail;
  formatDateTime: (value: number | null) => string;
  getAgentName: (agentId: string | null) => string;
  isPromptExpanded: boolean;
  onSelectStepRun: (stepRunId: string) => void;
  onTogglePromptExpanded: () => void;
  selectedRun: WorkflowDetail["runs"][number] | null;
  selectedStepRun: WorkflowStepRun | null;
  timelineStepRuns: WorkflowStepRun[];
};

export function WorkflowRunsColumn({
  detail,
  formatDateTime,
  getAgentName,
  isPromptExpanded,
  onSelectStepRun,
  onTogglePromptExpanded,
  selectedRun,
  selectedStepRun,
  timelineStepRuns,
}: WorkflowRunsColumnProps) {
  return (
    <section className="min-h-0 h-full overflow-y-auto">
      <div className="divide-y divide-border">
        <WorkflowDetailSection title="步骤时间线" bodyClassName="p-0">
          {timelineStepRuns.length > 0 ? (
            <div className="divide-y divide-border border-y border-border">
              {timelineStepRuns.map((stepRun) => {
                const stepName = detail.steps.find((item) => item.id === stepRun.stepId)?.name ?? stepRun.stepId;
                return (
                  <button
                    key={stepRun.id}
                    type="button"
                    onClick={() => onSelectStepRun(stepRun.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      selectedStepRun?.id === stepRun.id ? "bg-primary/6" : "hover:bg-foreground/[0.03]",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{stepName}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {getAgentName(detail.teamMembers.find((item) => item.id === stepRun.memberId)?.agentId ?? null)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      L{stepRun.loopIndex} / T{stepRun.attemptIndex}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {stepRun.decision?.outcome ?? "—"}
                    </span>
                    <span className="shrink-0 text-muted-foreground" title={stepRun.status} aria-label={stepRun.status}>
                      <StepRunStatusIcon status={stepRun.status} />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-sm text-muted-foreground">
              {detail.runs.length > 0 ? "当前运行还没有步骤日志。" : "运行后，这里会显示执行时间线。"}
            </div>
          )}
        </WorkflowDetailSection>

        <WorkflowDetailSection title="步骤详情" bodyClassName="p-0">
          {selectedStepRun ? (
            <div className="divide-y divide-border border-y border-border">
              <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                状态：{selectedStepRun.status} · 开始：{formatDateTime(selectedStepRun.startedAt)} · 结束：{formatDateTime(selectedStepRun.finishedAt)}
              </div>
              <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                轮次：L{selectedStepRun.loopIndex} / T{selectedStepRun.attemptIndex}
                {selectedRun ? ` · 当前运行结束原因：${selectedRun.stopReason ?? "—"}` : ""}
              </div>
              <div className="px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">输入提示词</p>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={isPromptExpanded ? "收起输入提示词" : "展开输入提示词"}
                    onClick={onTogglePromptExpanded}
                  >
                    {isPromptExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className={cn("mt-2 overflow-hidden", isPromptExpanded ? "" : "max-h-[7.5rem]")}>
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {selectedStepRun.inputPrompt || "—"}
                  </pre>
                </div>
              </div>
              {selectedStepRun.resultText ? (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">输出文本</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.resultText}</pre>
                </div>
              ) : null}
              {selectedStepRun.decision ? (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">分支决策</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {JSON.stringify(selectedStepRun.decision, null, 2)}
                  </pre>
                </div>
              ) : null}
              {selectedStepRun.resultJson ? (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">审查结果</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {JSON.stringify(selectedStepRun.resultJson, null, 2)}
                  </pre>
                </div>
              ) : null}
              {selectedStepRun.decisionResultJson ? (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">结构化判断结果</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {JSON.stringify(selectedStepRun.decisionResultJson, null, 2)}
                  </pre>
                </div>
              ) : null}
              {selectedStepRun.messageType ? (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">消息类型</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.messageType}</pre>
                </div>
              ) : null}
              {selectedStepRun.messageJson ? (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">结构化消息</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {JSON.stringify(selectedStepRun.messageJson, null, 2)}
                  </pre>
                </div>
              ) : null}
              {selectedStepRun.parts.map((part, index) => (
                <div key={`${selectedStepRun.id}-part-${index}`} className="px-3 py-3">
                  <AgentPartRenderer part={part} />
                </div>
              ))}
              {selectedStepRun.errorMessage ? (
                <div className="px-3 py-3 text-sm text-destructive">
                  {selectedStepRun.errorMessage}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-8 text-sm text-muted-foreground">
              选择一条步骤日志后，这里会显示输入、输出和错误信息。
            </div>
          )}
        </WorkflowDetailSection>
      </div>
    </section>
  );
}
