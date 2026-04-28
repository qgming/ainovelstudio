import type { AgentMessage, AgentUsage } from "../../lib/agent/types";

type AgentContextOverviewProps = {
  currentModel: string;
  messages: AgentMessage[];
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7b8798] dark:text-[#8b97a8]">
        {label}
      </p>
      <p className="break-words text-[15px] leading-6 text-[#111827] dark:text-[#eef2f7]">{value}</p>
    </div>
  );
}

function ContextBreakdown({ usage }: { usage: AgentUsage | null }) {
  const segments = buildBreakdownSegments(usage);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (!usage || total <= 0) {
    return (
      <div className="rounded-[14px] border border-[#e2e8f0] bg-white/92 p-4 dark:border-[#273142] dark:bg-[#111827]/92">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#66758a] dark:text-[#8b97a8]">
          上下文拆分
        </p>
        <p className="mt-3 text-sm leading-6 text-[#718096] dark:text-[#7f8a9b]">
          发送第一条消息后，这里会显示最近一次模型调用的上下文占用。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-[#e2e8f0] bg-white/92 p-4 dark:border-[#273142] dark:bg-[#111827]/92">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#66758a] dark:text-[#8b97a8]">
        上下文拆分
      </p>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-[#e2e8f0] dark:bg-[#1f2937]">
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
          <div key={segment.label} className="inline-flex items-center gap-2 text-xs text-[#667085] dark:text-[#9aa4b2]">
            <span className={`h-3 w-3 rounded-full ${segment.colorClassName}`} />
            <span>
              {segment.label} {((segment.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentContextOverview({
  currentModel,
  messages,
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
    <div className="space-y-3 p-1">
      <div className="rounded-[14px] border border-[#e2e8f0] bg-white/92 p-4 dark:border-[#273142] dark:bg-[#111827]/92">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <MetricCard label="会话" value={sessionTitle || "新对话"} />
          <MetricCard label="消息数" value={formatCount(visibleMessages.length)} />
          <MetricCard label="模型" value={modelName} />
          <MetricCard label="模型调用" value={formatCount(usageList.length)} />
          <MetricCard label="创建时间" value={formatEpoch(sessionCreatedAt)} />
          <MetricCard label="最后活动" value={formatEpoch(sessionUpdatedAt)} />
          <MetricCard label="用户消息" value={formatCount(userMessageCount)} />
          <MetricCard label="助手消息" value={formatCount(assistantMessageCount)} />
          <MetricCard label="本轮总 token" value={formatCount(latestUsage?.totalTokens ?? 0)} />
          <MetricCard label="本轮输入 token" value={formatCount(latestUsage?.inputTokens ?? 0)} />
          <MetricCard label="本轮输出 token" value={formatCount(latestUsage?.outputTokens ?? 0)} />
          <MetricCard label="推理 token" value={formatCount(latestUsage?.reasoningTokens ?? 0)} />
          <MetricCard
            label="缓存 token（读/写）"
            value={`${formatCount(latestUsage?.cacheReadTokens ?? 0)} / ${formatCount(latestUsage?.cacheWriteTokens ?? 0)}`}
          />
          <MetricCard label="会话累计 token" value={formatCount(sessionUsage.totalTokens)} />
        </div>
      </div>
      <ContextBreakdown usage={latestUsage} />
    </div>
  );
}
