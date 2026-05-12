import type { ReactNode } from "react";
import type { AgentMessage, AgentUsage } from "@features/agent/lib/types";

type AgentContextOverviewProps = {
  compactionCount?: number;
  currentModel: string;
  isCompacting?: boolean;
  latestCompactionAt?: string | null;
  latestCompactionSummary?: string | null;
  latestCompactionTokensBefore?: number | null;
  messages: AgentMessage[];
  onCompact?: () => void;
  sessionCreatedAt?: string | null;
  sessionTitle: string;
  sessionUpdatedAt?: string | null;
};

type UsageSummary = {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type BreakdownSegment = {
  colorClassName: string;
  label: string;
  value: number;
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatCount(value: number) {
  return numberFormatter.format(value);
}

function formatEpoch(value?: string | null) {
  if (!value) {
    return "—";
  }

  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "—";
  }

  return timeFormatter.format(new Date(timestamp * 1000));
}

function buildEmptyUsageSummary(): UsageSummary {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function sumUsage(usageList: AgentUsage[]) {
  return usageList.reduce<UsageSummary>(
    (summary, usage) => ({
      cacheReadTokens: summary.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens + usage.cacheWriteTokens,
      inputTokens: summary.inputTokens + usage.inputTokens,
      outputTokens: summary.outputTokens + usage.outputTokens,
      reasoningTokens: summary.reasoningTokens + usage.reasoningTokens,
      totalTokens: summary.totalTokens + usage.totalTokens,
    }),
    buildEmptyUsageSummary(),
  );
}

function collectUsage(messages: AgentMessage[]) {
  return messages.flatMap((message) =>
    message.role === "assistant" && message.meta?.usage ? [message.meta.usage] : []
  );
}

function buildBreakdownSegments(usage: AgentUsage | null): BreakdownSegment[] {
  if (!usage) {
    return [];
  }

  const detailsTotal = usage.noCacheTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const freshInput = detailsTotal > 0 ? usage.noCacheTokens : usage.inputTokens;

  return [
    { colorClassName: "bg-[#2f855a]", label: detailsTotal > 0 ? "新输入" : "输入", value: freshInput },
    { colorClassName: "bg-[#805ad5]", label: "缓存命中", value: usage.cacheReadTokens },
    { colorClassName: "bg-[#0f766e]", label: "缓存写入", value: usage.cacheWriteTokens },
    { colorClassName: "bg-[#a16207]", label: "输出", value: usage.outputTokens },
    { colorClassName: "bg-[#64748b]", label: "推理", value: usage.reasoningTokens },
  ].filter((segment) => segment.value > 0);
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-border/80 py-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-[13px] leading-5 text-foreground">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </p>
  );
}

function ContextBreakdown({ usage }: { usage: AgentUsage | null }) {
  const segments = buildBreakdownSegments(usage);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (!usage || total <= 0) {
    return (
      <section className="border-t border-border px-4 py-3">
        <SectionTitle>上下文拆分</SectionTitle>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          发送第一条消息后，这里会显示最近一次模型调用的上下文占用。
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-border px-4 py-3">
      <SectionTitle>上下文拆分</SectionTitle>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="flex h-full w-full">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className={segment.colorClassName}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {segments.map((segment) => (
          <div key={segment.label} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-full ${segment.colorClassName}`} />
            <span>
              {segment.label} {((segment.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompactionSummary({
  latestCompactionSummary,
}: {
  latestCompactionSummary?: string | null;
}) {
  const summary = latestCompactionSummary?.trim();

  return (
    <section className="border-t border-border px-4 py-3">
      <SectionTitle>压缩内容</SectionTitle>
      {summary ? (
        <div className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap border-l border-border pl-3 text-xs leading-6 text-foreground">
          {summary}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          暂无压缩内容。压缩上下文后，这里会显示保留下来的会话摘要。
        </p>
      )}
    </section>
  );
}

export function AgentContextOverview({
  compactionCount = 0,
  currentModel,
  isCompacting = false,
  latestCompactionAt,
  latestCompactionSummary,
  latestCompactionTokensBefore,
  messages,
  onCompact,
  sessionCreatedAt,
  sessionTitle,
  sessionUpdatedAt,
}: AgentContextOverviewProps) {
  const visibleMessages = messages.filter((message) => message.role === "user" || message.role === "assistant");
  const userMessageCount = visibleMessages.filter((message) => message.role === "user").length;
  const assistantMessageCount = visibleMessages.filter((message) => message.role === "assistant").length;
  const usageList = collectUsage(messages);
  const latestUsage = usageList.at(-1) ?? null;
  const sessionUsage = sumUsage(usageList);
  const modelName = latestUsage?.modelId || currentModel.trim() || "未配置模型";

  return (
    <div className="max-h-[min(72vh,42rem)] overflow-y-auto py-1">
      <section className="px-4 pb-3">
        <SectionTitle>会话参数</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-x-5">
          <MetricItem label="会话" value={sessionTitle || "新对话"} />
          <MetricItem label="消息数" value={formatCount(visibleMessages.length)} />
          <MetricItem label="模型" value={modelName} />
          <MetricItem label="模型调用" value={formatCount(usageList.length)} />
          <MetricItem label="创建时间" value={formatEpoch(sessionCreatedAt)} />
          <MetricItem label="最后活动" value={formatEpoch(sessionUpdatedAt)} />
          <MetricItem label="用户消息" value={formatCount(userMessageCount)} />
          <MetricItem label="助手消息" value={formatCount(assistantMessageCount)} />
          <MetricItem label="本轮总 token" value={formatCount(latestUsage?.totalTokens ?? 0)} />
          <MetricItem label="本轮输入 token" value={formatCount(latestUsage?.inputTokens ?? 0)} />
          <MetricItem label="本轮输出 token" value={formatCount(latestUsage?.outputTokens ?? 0)} />
          <MetricItem label="推理 token" value={formatCount(latestUsage?.reasoningTokens ?? 0)} />
          <MetricItem
            label="缓存 token（读/写）"
            value={`${formatCount(latestUsage?.cacheReadTokens ?? 0)} / ${formatCount(latestUsage?.cacheWriteTokens ?? 0)}`}
          />
          <MetricItem label="会话累计 token" value={formatCount(sessionUsage.totalTokens)} />
          <MetricItem label="压缩次数" value={formatCount(compactionCount)} />
          <MetricItem label="最近压缩" value={formatEpoch(latestCompactionAt)} />
          <MetricItem
            label="压缩前 token"
            value={formatCount(latestCompactionTokensBefore ?? 0)}
          />
        </div>
        {onCompact ? (
          <button
            type="button"
            className="mt-3 h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isCompacting}
            onClick={onCompact}
          >
            {isCompacting ? "正在压缩" : "压缩上下文"}
          </button>
        ) : null}
      </section>
      <ContextBreakdown usage={latestUsage} />
      <CompactionSummary latestCompactionSummary={latestCompactionSummary} />
    </div>
  );
}
