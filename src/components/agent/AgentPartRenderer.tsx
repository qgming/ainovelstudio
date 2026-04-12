import { useState } from "react";
import { ChevronDown, ChevronRight, Brain, Wrench, Check, X, LoaderCircle, Users, Circle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getRunStatusTone, type AgentPart } from "../../lib/agent/types";

const statusClasses = {
  danger: "border-[#5d2626] bg-[#2b1719] text-[#f6b6b0] dark:border-[#6f2e2e] dark:bg-[#2b1719] dark:text-[#f6b6b0]",
  neutral: "border-[#dde4f0] bg-[#f8fafc] text-[#5b6475] dark:border-[#2a2f37] dark:bg-[#171a1f] dark:text-[#9ca7b8]",
  success: "border-[#1f5b44] bg-[#eafaf2] text-[#1d6a4d] dark:border-[#22553f] dark:bg-[#13221a] dark:text-[#9fe2bb]",
  warning: "border-[#6d5321] bg-[#fff6de] text-[#8a6412] dark:border-[#5c4620] dark:bg-[#261f12] dark:text-[#f3c96b]",
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

function StatusPill({ status }: { status: "idle" | "running" | "completed" | "failed" }) {
  const tone = getRunStatusTone(status);
  const labelMap = {
    idle: "空闲",
    running: "运行中",
    completed: "运行成功",
    failed: "运行失败",
  } as const;

  if (status === "running") {
    return (
      <span
        aria-label={labelMap[status]}
        title={labelMap[status]}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${statusClasses[tone]}`}
      >
        <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span
        aria-label={labelMap[status]}
        title={labelMap[status]}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${statusClasses[tone]}`}
      >
        <Check aria-hidden="true" className="h-3 w-3" />
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        aria-label={labelMap[status]}
        title={labelMap[status]}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${statusClasses[tone]}`}
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </span>
    );
  }

  return (
    <span
      aria-label={labelMap[status]}
      title={labelMap[status]}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${statusClasses[tone]}`}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
    </span>
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
    <section className="rounded-[8px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-[#8c97a8] dark:text-zinc-500" />
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#64748b] dark:text-zinc-400" />
        <span className="text-[12px] font-medium text-[#475569] dark:text-zinc-300">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[#8c97a8] dark:text-zinc-500">
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
          className={`border-t border-[#e2e8f0] px-3 py-2.5 dark:border-[#20242b] ${collapseOnContentClick ? "cursor-pointer" : ""}`.trim()}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function MarkdownText({ className = "", text }: { className?: string; text: string }) {
  return (
    <div className={`agent-markdown text-sm leading-6 text-inherit ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0 text-inherit">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-1 text-inherit last:mb-0">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-current/20 pl-3 opacity-90 last:mb-0">{children}</blockquote>
          ),
          code: ({ children, className, ...props }) => (
            <code
              {...props}
              className={`rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.92em] text-inherit dark:bg-white/10 ${className ?? ""}`.trim()}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-[8px] bg-black/10 px-3 py-2 font-mono text-[0.92em] text-inherit dark:bg-white/10 last:mb-0">
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
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
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-left text-inherit">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-current/15 px-2 py-1 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-current/15 px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

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
        status: part.status,
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

export function AgentPartRenderer({ part }: { part: AgentPart }) {
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
    return <MarkdownText text={part.text} />;
  }

  if (part.type === "reasoning") {
    return (
      <AccordionCard collapseOnContentClick icon={Brain} label="思考" summary={part.summary}>
        <MarkdownText className="text-[#51627c] dark:text-[#95a7c1]" text={[part.summary, part.detail].filter(Boolean).join("\n\n")} />
      </AccordionCard>
    );
  }

  if (part.type === "tool-call") {
    const formattedInput = formatStructuredText(part.inputSummary);
    const formattedOutput = part.outputSummary ? formatStructuredText(part.outputSummary) : null;

    return (
      <AccordionCard
        collapseOnContentClick
        icon={Wrench}
        label={part.toolName}
        summary={part.status === "running" ? part.inputSummary : part.outputSummary ?? part.inputSummary}
        status={part.status}
      >
        <div className="space-y-2 text-sm leading-6 text-[#607089] dark:text-[#98a6bc]">
          <MarkdownText text={formattedInput} />
          {formattedOutput ? (
            <div className="px-0 py-0 text-[#42536b] dark:text-[#c1cede]">
              <MarkdownText text={formattedOutput} />
            </div>
          ) : null}
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
        status={part.status}
      >
        <div className="space-y-2 text-sm leading-6 text-[#607089] dark:text-[#98a6bc]">
          <div className="rounded-[8px] border border-[#f5c2c7] bg-[#fff5f6] px-3 py-2 text-[#9f1239] dark:border-[#5d2626] dark:bg-[#2b1719] dark:text-[#fda4af]">
            {part.validationError}
          </div>
          {formattedOutput ? <MarkdownText text={formattedOutput} /> : null}
        </div>
      </AccordionCard>
    );
  }

  if (part.type !== "subagent") {
    return null;
  }

  const timeline = buildSubagentTimeline(part.parts);

  return (
    <AccordionCard icon={Users} label={part.name} summary={part.summary} status={part.status}>
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium leading-6 text-[#42536b] dark:text-[#e2e8f0]">时间线</h3>
          <div>
            <div className="flex items-start gap-3">
              <div className="flex w-4 shrink-0 flex-col items-center self-stretch pt-1">
                <StepStatusIcon status="completed" />
                <div className="mt-1 w-px flex-1 border-l border-dashed border-[#cbd5e1] dark:border-[#334155]" />
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <p className="text-sm leading-6 text-[#42536b] dark:text-[#c1cede]">已接收任务</p>
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
                    <p className="text-sm font-medium leading-6 text-[#42536b] dark:text-[#e2e8f0]">{item.label}</p>
                    <p className="line-clamp-3 text-sm leading-6 text-[#6b7280] dark:text-[#94a3b8]">{item.preview}</p>
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

