import { useState, memo } from "react";
import { ChevronDown, ChevronRight, Brain, Wrench, Check, X, LoaderCircle, Users, Circle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type AgentPart, type AgentRunStatus } from "@features/agent/lib/types";
import { getTodoItemsFromPart, type PlanItem } from "@features/agent/lib/planning";

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0 text-inherit">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1 text-inherit last:mb-0">{children}</li>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="mb-3 border-l-2 border-current/20 pl-3 opacity-90 last:mb-0">{children}</blockquote>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => (
    <code
      {...props}
      className={`rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.92em] text-inherit dark:bg-white/10 ${className ?? ""}`.trim()}
    >
      {children}
    </code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="mb-3 overflow-x-auto rounded-[8px] bg-black/10 px-3 py-2 font-mono text-[0.92em] text-inherit dark:bg-white/10 last:mb-0">
      {children}
    </pre>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 text-inherit opacity-90 hover:opacity-100"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-current/15" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-inherit">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => <th className="border border-current/15 px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border border-current/15 px-2 py-1 align-top">{children}</td>,
} as const;

function StepStatusIcon({ status }: { status: "idle" | "running" | "completed" | "failed" }) {
  if (status === "running") {
    return <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 text-[#8a6412] animate-spin dark:text-[#f3c96b]" />;
  }

  if (status === "completed") {
    return <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#1d6a4d] dark:text-[#9fe2bb]" />;
  }

  if (status === "failed") {
    return <X aria-hidden="true" className="h-3.5 w-3.5 text-[#dc2626] dark:text-[#f87171]" />;
  }

  return <Circle aria-hidden="true" className="h-3.5 w-3.5 text-[#94a3b8] dark:text-[#64748b]" />;
}

function PlanItemIcon({ status }: { status: PlanItem["status"] }) {
  if (status === "completed") {
    return <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#1d6a4d] dark:text-[#9fe2bb]" />;
  }

  if (status === "in_progress") {
    return <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-[#8a6412] dark:text-[#f3c96b]" />;
  }

  return <Circle aria-hidden="true" className="h-3.5 w-3.5 text-[#94a3b8] dark:text-[#64748b]" />;
}

function PlanProgressCard({
  items,
  part,
}: {
  items: PlanItem[];
  part: Extract<AgentPart, { type: "tool-call" }>;
}) {
  const completedCount = items.filter((item) => item.status === "completed").length;
  const activeItem = items.find((item) => item.status === "in_progress");
  const summary = items.length === 0
    ? "当前计划已清空"
    : activeItem?.activeForm || activeItem?.content || `已完成 ${completedCount}/${items.length}`;

  return (
    <section className="rounded-[8px] border border-border bg-message-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">任务进度</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{summary}</span>
        <StatusPill status={normalizeRenderableStatus(part.status)} />
      </div>
      <div className="px-3 py-2.5">
        {items.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">当前没有待办任务。</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item, index) => (
              <div key={`${index}-${item.content}-${item.status}`} className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                  <PlanItemIcon status={item.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={[
                      "break-words text-sm font-medium leading-6",
                      item.status === "completed"
                        ? "text-muted-foreground line-through decoration-muted-foreground/50"
                        : "text-foreground",
                    ].join(" ")}
                  >
                    {index + 1}. {item.phase ? <span className="text-muted-foreground">[{item.phase}] </span> : null}
                    {item.content}
                  </div>
                  {item.status === "in_progress" && item.activeForm ? (
                    <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.activeForm}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {part.validationError ? (
          <div className="mt-3 rounded-[8px] border border-[#f5c2c7] bg-[#fff5f6] px-3 py-2 text-sm text-[#9f1239] dark:border-[#5d2626] dark:bg-[#2b1719] dark:text-[#fda4af]">
            {part.validationError}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: "idle" | "running" | "completed" | "failed" }) {
  const labelMap = {
    idle: "空闲",
    running: "运行中",
    completed: "运行成功",
    failed: "运行失败",
  } as const;
  const colorClassName =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : "bg-amber-400";

  return (
    <span
      aria-label={labelMap[status]}
      title={labelMap[status]}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colorClassName}`}
    />
  );
}

function AccordionCard({
  collapseOnContentClick = false,
  children,
  icon: Icon,
  label,
  status,
  summary,
}: {
  collapseOnContentClick?: boolean;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status?: "idle" | "running" | "completed" | "failed";
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section className="rounded-[8px] border border-border bg-message-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {summary}
        </span>
        {status ? <StatusPill status={status} /> : null}
      </button>
      {open ? (
        <div
          role={collapseOnContentClick ? "button" : undefined}
          tabIndex={collapseOnContentClick ? 0 : undefined}
          onClick={collapseOnContentClick ? () => setOpen(false) : undefined}
          onKeyDown={
            collapseOnContentClick
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }
              : undefined
          }
          className={`border-t border-border px-3 py-2.5 ${collapseOnContentClick ? "cursor-pointer" : ""}`.trim()}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

const MarkdownText = memo(function MarkdownText({ className = "", text }: { className?: string; text: string }) {
  return (
    <div className={`agent-markdown text-sm leading-6 text-inherit ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

function formatStructuredText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return text;
  }
}

function normalizeRenderableStatus(status: AgentRunStatus): "idle" | "running" | "completed" | "failed" {
  return status === "awaiting_user" ? "running" : status;
}

function buildSubagentTimeline(parts: AgentPart[]) {
  const timeline: Array<{
    key: string;
    label: string;
    preview: string;
    status: "idle" | "running" | "completed" | "failed";
  }> = [];

  for (const [index, part] of parts.entries()) {
    if (part.type === "reasoning") {
      timeline.push({
        key: `reasoning-${index}`,
        label: "深度思考",
        preview: part.detail,
        status: "running",
      });
      continue;
    }

    if (part.type === "tool-call") {
      timeline.push({
        key: `tool-${index}-${part.toolName}`,
        label: `调用工具：${part.toolName}`,
        preview: part.outputSummary ?? part.inputSummary,
        status: normalizeRenderableStatus(part.status),
      });
      continue;
    }

    if (part.type === "text") {
      timeline.push({
        key: `text-${index}`,
        label: "生成结果",
        preview: part.text,
        status: "completed",
      });
    }
  }

  return timeline;
}

export function AgentPartRenderer({ part, renderMarkdown = true }: { part: AgentPart; renderMarkdown?: boolean }) {
  if (part.type === "placeholder") {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-inherit opacity-80">
        <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        <span>{part.text}</span>
      </div>
    );
  }

  if (part.type === "text-delta") {
    return null;
  }

  if (part.type === "text") {
    if (!renderMarkdown) {
      return <div className="whitespace-pre-wrap break-words text-sm leading-6 text-inherit">{part.text}</div>;
    }
    return <MarkdownText text={part.text} />;
  }

  if (part.type === "reasoning") {
    return (
      <AccordionCard collapseOnContentClick icon={Brain} label="思考" summary={part.detail}>
        <MarkdownText className="text-foreground" text={part.detail} />
      </AccordionCard>
    );
  }

  if (part.type === "tool-call") {
    if (part.toolName === "update_plan") {
      const items = getTodoItemsFromPart(part);
      if (items) {
        return <PlanProgressCard items={items} part={part} />;
      }
    }

    const formattedOutput = part.outputSummary ? formatStructuredText(part.outputSummary) : null;
    const summary = part.outputSummary
      || (part.status === "running" || part.status === "awaiting_user" ? "正在执行..." : "无输出内容");

    return (
      <AccordionCard
        collapseOnContentClick
        icon={Wrench}
        label={part.toolName}
        summary={summary}
        status={normalizeRenderableStatus(part.status)}
      >
        <div className="space-y-2 text-sm leading-6 text-foreground">
          {formattedOutput ? (
            <div className="px-0 py-0 text-foreground">
              <MarkdownText text={formattedOutput} />
            </div>
          ) : (
            <div className="text-sm leading-6 text-muted-foreground">
              {part.status === "running" || part.status === "awaiting_user" ? "正在等待工具返回结果。" : "无输出内容。"}
            </div>
          )}
          {part.validationError ? (
            <div className="rounded-[8px] border border-[#f5c2c7] bg-[#fff5f6] px-3 py-2 text-[#9f1239] dark:border-[#5d2626] dark:bg-[#2b1719] dark:text-[#fda4af]">
              {part.validationError}
            </div>
          ) : null}
        </div>
      </AccordionCard>
    );
  }

  if (part.type === "tool-result") {
    if (!part.validationError) {
      return null;
    }

    const formattedOutput = formatStructuredText(part.outputSummary);
    return (
      <AccordionCard
        collapseOnContentClick
        icon={Wrench}
        label={`${part.toolName} 结果异常`}
        summary={part.validationError}
        status={normalizeRenderableStatus(part.status)}
      >
        <div className="space-y-2 text-sm leading-6 text-foreground">
          <div className="rounded-[8px] border border-[#f5c2c7] bg-[#fff5f6] px-3 py-2 text-[#9f1239] dark:border-[#5d2626] dark:bg-[#2b1719] dark:text-[#fda4af]">
            {part.validationError}
          </div>
          {formattedOutput ? <MarkdownText text={formattedOutput} /> : null}
        </div>
      </AccordionCard>
    );
  }

  if (part.type === "ask-user") {
    const answerText = part.answer?.values.map((item) => item.value).filter(Boolean).join("；");
    const summary = part.status === "awaiting_user"
      ? part.title
      : part.status === "completed"
        ? `已提交：${answerText || "已收到用户回答。"}`
        : part.errorMessage || "等待用户输入已中断。";

    return (
      <AccordionCard
        icon={Wrench}
        label="询问用户"
        summary={summary}
        status={part.status === "awaiting_user" ? "running" : part.status}
      >
        <div className="space-y-3 text-sm leading-6 text-foreground">
          <div>
            <div className="font-medium text-foreground">{part.title}</div>
            {part.description ? (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{part.description}</div>
            ) : null}
          </div>
          <div className="space-y-2">
            {part.options.map((option) => {
              const answer = part.answer?.values.find((item) => item.id === option.id);
              const selected = Boolean(answer);
              return (
                <div
                  key={option.id}
                  className={`rounded-md border px-3 py-2 ${
                    selected ? "border-foreground/30 bg-accent" : "border-border bg-panel"
                  }`}
                >
                  <div className="text-sm font-medium text-foreground">{option.label}</div>
                  {option.description ? (
                    <div className="text-xs leading-5 text-muted-foreground">{option.description}</div>
                  ) : null}
                  {answer ? (
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{answer.value}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {part.status === "failed" && part.errorMessage ? (
            <div className="rounded-[8px] border border-[#f5c2c7] bg-[#fff5f6] px-3 py-2 text-[#9f1239] dark:border-[#5d2626] dark:bg-[#2b1719] dark:text-[#fda4af]">
              {part.errorMessage}
            </div>
          ) : null}
        </div>
      </AccordionCard>
    );
  }

  if (part.type !== "subagent") {
    return null;
  }

  const timeline = buildSubagentTimeline(part.parts);

  return (
    <AccordionCard icon={Users} label={part.name} summary={part.summary} status={normalizeRenderableStatus(part.status)}>
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium leading-6 text-foreground">时间线</h3>
          <div>
            <div className="flex items-start gap-3">
              <div className="flex w-4 shrink-0 flex-col items-center self-stretch pt-1">
                <StepStatusIcon status="completed" />
                <div className="mt-1 w-px flex-1 border-l border-dashed border-[#cbd5e1] dark:border-[#334155]" />
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <p className="text-sm leading-6 text-foreground">已接收任务</p>
              </div>
            </div>
            {timeline.map((item, index) => {
              const isLast = index === timeline.length - 1;
              return (
                <div key={item.key} className="flex items-start gap-3">
                  <div className="flex w-4 shrink-0 flex-col items-center self-stretch pt-1">
                    <StepStatusIcon status={item.status} />
                    {!isLast ? <div className="mt-1 w-px flex-1 border-l border-dashed border-[#cbd5e1] dark:border-[#334155]" /> : null}
                  </div>
                  <div className={`min-w-0 flex-1 ${!isLast ? "pb-3" : ""}`}>
                    <p className="text-sm font-medium leading-6 text-foreground">{item.label}</p>
                    <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{item.preview}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AccordionCard>
  );
}
