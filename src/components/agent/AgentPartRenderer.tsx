import { useState } from "react";
import { ChevronDown, ChevronRight, Brain, Wrench, Check, X, LoaderCircle, Users } from "lucide-react";
import { getRunStatusTone, type AgentPart } from "../../lib/agent/types";

const statusClasses = {
  danger: "border-[#5d2626] bg-[#2b1719] text-[#f6b6b0] dark:border-[#6f2e2e] dark:bg-[#2b1719] dark:text-[#f6b6b0]",
  neutral: "border-[#dde4f0] bg-[#f8fafc] text-[#5b6475] dark:border-[#2a2f37] dark:bg-[#171a1f] dark:text-[#9ca7b8]",
  success: "border-[#1f5b44] bg-[#eafaf2] text-[#1d6a4d] dark:border-[#22553f] dark:bg-[#13221a] dark:text-[#9fe2bb]",
  warning: "border-[#6d5321] bg-[#fff6de] text-[#8a6412] dark:border-[#5c4620] dark:bg-[#261f12] dark:text-[#f3c96b]",
} as const;

function StatusPill({ status }: { status: "idle" | "running" | "completed" | "failed" }) {
  const tone = getRunStatusTone(status);

  if (status === "running") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${statusClasses[tone]}`}
      >
        <LoaderCircle className="h-3 w-3 animate-spin" />
        运行中
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${statusClasses[tone]}`}
      >
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#1d6a4d] text-white dark:bg-[#4ade80] dark:text-[#052e16]">
          <Check className="h-3 w-3" />
        </span>
        运行成功
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${statusClasses[tone]}`}
      >
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#dc2626] text-white dark:bg-[#f87171] dark:text-[#450a0a]">
          <X className="h-3 w-3" />
        </span>
        运行失败
      </span>
    );
  }

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClasses[tone]}`}
    >
      {status}
    </span>
  );
}

function AccordionCard({
  children,
  icon: Icon,
  label,
  status,
  summary,
}: {
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
        <div className="border-t border-[#e2e8f0] px-3 py-2.5 dark:border-[#20242b]">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function AgentPartRenderer({ part }: { part: AgentPart }) {
  if (part.type === "text-delta") {
    return null;
  }

  if (part.type === "text") {
    return <p className="text-sm leading-6 text-inherit">{part.text}</p>;
  }

  if (part.type === "reasoning") {
    return (
      <AccordionCard icon={Brain} label="思考" summary={part.summary}>
        <p className="text-sm font-medium text-[#1f3656] dark:text-[#c8d7ee]">{part.summary}</p>
        <p className="mt-1.5 text-sm leading-6 text-[#51627c] dark:text-[#95a7c1]">
          {part.detail}
        </p>
      </AccordionCard>
    );
  }

  if (part.type === "tool-call") {
    return (
      <AccordionCard
        icon={Wrench}
        label={part.toolName}
        summary={part.status === "running" ? part.inputSummary : part.outputSummary ?? part.inputSummary}
        status={part.status}
      >
        <div className="space-y-2 text-sm leading-6 text-[#607089] dark:text-[#98a6bc]">
          <p>{part.inputSummary}</p>
          {part.outputSummary ? (
            <div className="rounded-[8px] bg-[#f4f7fb] px-2.5 py-2 text-[#42536b] dark:bg-[#1a1f27] dark:text-[#c1cede]">
              {part.outputSummary}
            </div>
          ) : null}
        </div>
      </AccordionCard>
    );
  }

  if (part.type === "tool-result") {
    return null;
  }

  return (
    <AccordionCard icon={Users} label={part.name} summary={part.summary} status={part.status}>
      <div className="space-y-2">
        <p className="text-sm leading-6 text-[#5a4c82] dark:text-[#b9acd9]">{part.summary}</p>
        {part.detail ? (
          <div className="rounded-[8px] bg-[#f4f7fb] px-2.5 py-2 text-sm leading-6 text-[#42536b] dark:bg-[#1a1f27] dark:text-[#c1cede]">
            {part.detail}
          </div>
        ) : null}
      </div>
    </AccordionCard>
  );
}
