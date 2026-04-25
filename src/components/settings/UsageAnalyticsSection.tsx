import { useEffect, useMemo, useState } from "react";
import { Activity, DatabaseZap, Filter, History, RefreshCw } from "lucide-react";
import { readUsageLogs } from "../../lib/usage/api";
import type { UsageLogEntry, UsageSourceType } from "../../lib/usage/types";
import { UsageHeatmap } from "./UsageHeatmap";
import { SettingsHeaderResponsiveButton, SettingsSectionHeader } from "./SettingsSectionHeader";
import { UsageLogTable } from "./UsageLogTable";

type TimeRangeKey = "7d" | "30d" | "90d" | "all";
type HeatmapDay = {
  dateKey: string;
  dayLabel: string;
  requestCount: number;
  tokenTotal: number;
  level: 0 | 1 | 2 | 3 | 4;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_COLUMN_COUNT = 42;
const HEATMAP_ROW_COUNT = 10;
const HEATMAP_DAY_COUNT = HEATMAP_COLUMN_COUNT * HEATMAP_ROW_COUNT;
const numberFormatter = new Intl.NumberFormat("zh-CN");
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
});

function parseEpoch(value: string) {
  return Number(value) * 1000;
}

function padDatePart(value: number) {
  return value.toString().padStart(2, "0");
}

export function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  return `${year}-${month}-${day}`;
}

function toDateKey(value: string) {
  return toLocalDateKey(new Date(parseEpoch(value)));
}

function formatDateTime(value: string) {
  return timeFormatter.format(new Date(parseEpoch(value)));
}

function formatMetric(value: number) {
  return numberFormatter.format(value);
}

function resolveRangeStart(range: TimeRangeKey) {
  if (range === "all") {
    return 0;
  }

  const dayCount = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const now = Date.now();
  return now - (dayCount - 1) * DAY_MS;
}

export function resolveHeatmapLevel(requestCount: number, maxCount: number): HeatmapDay["level"] {
  if (requestCount <= 0 || maxCount <= 0) {
    return 0;
  }

  if (maxCount === 1) {
    return 1;
  }

  return Math.min(4, Math.max(1, Math.ceil((requestCount / maxCount) * 4))) as HeatmapDay["level"];
}

export function buildHeatmapDays(logs: UsageLogEntry[]) {
  const byDay = new Map<string, { requestCount: number; tokenTotal: number }>();
  for (const log of logs) {
    const dateKey = toDateKey(log.recordedAt || log.createdAt);
    const current = byDay.get(dateKey) ?? { requestCount: 0, tokenTotal: 0 };
    byDay.set(dateKey, {
      requestCount: current.requestCount + 1,
      tokenTotal: current.tokenTotal + log.totalTokens,
    });
  }

  const maxCount = Math.max(...Array.from(byDay.values(), (entry) => entry.requestCount), 0);
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end.getTime() - (HEATMAP_DAY_COUNT - 1) * DAY_MS);
  const days: HeatmapDay[] = [];

  for (let index = 0; index < HEATMAP_DAY_COUNT; index += 1) {
    const current = new Date(start.getTime() + index * DAY_MS);
    const dateKey = toLocalDateKey(current);
    const dayEntry = byDay.get(dateKey) ?? { requestCount: 0, tokenTotal: 0 };
    days.push({
      dateKey,
      dayLabel: current.toLocaleDateString("zh-CN", { day: "2-digit", month: "2-digit" }),
      level: resolveHeatmapLevel(dayEntry.requestCount, maxCount),
      requestCount: dayEntry.requestCount,
      tokenTotal: dayEntry.tokenTotal,
    });
  }

  return days;
}

function MetricCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "blue" | "violet" | "emerald";
}) {
  const toneClassName =
    tone === "blue"
      ? "text-blue-700 dark:text-blue-300"
      : tone === "violet"
        ? "text-violet-700 dark:text-violet-300"
        : tone === "emerald"
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-[#0f172a] dark:text-white";
  return (
    <div className="border-r border-b border-[#e2e8f0] px-4 py-4 last:border-r-0 dark:border-[#20242b]">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#94a3b8] dark:text-[#64748b]">{label}</p>
      <p className={`mt-3 text-[26px] font-semibold tracking-[-0.05em] ${toneClassName}`}>
        {formatMetric(value)}
      </p>
    </div>
  );
}

function summarizeLogs(logs: UsageLogEntry[]) {
  return logs.reduce(
    (accumulator, log) => ({
      requests: accumulator.requests + 1,
      totalTokens: accumulator.totalTokens + log.totalTokens,
      inputTokens: accumulator.inputTokens + log.inputTokens,
      outputTokens: accumulator.outputTokens + log.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0 },
  );
}

function getSourceSummary(logs: UsageLogEntry[], sourceType: UsageSourceType) {
  return summarizeLogs(logs.filter((log) => log.sourceType === sourceType));
}

function SourceSummaryCard({
  sourceType,
  summary,
}: {
  sourceType: UsageSourceType;
  summary: ReturnType<typeof summarizeLogs>;
}) {
  const meta =
    sourceType === "workflow"
      ? {
          requestsLabel: "工作流请求",
          tokenLabel: "工作流 Tokens",
          tone: "violet" as const,
        }
      : sourceType === "expansion"
        ? {
            requestsLabel: "创作台请求",
            tokenLabel: "创作台 Tokens",
            tone: "emerald" as const,
          }
        : {
            requestsLabel: "图书 Agent 请求",
            tokenLabel: "图书 Agent Tokens",
            tone: "blue" as const,
          };

  return (
    <div className="grid border-b border-border sm:grid-cols-2">
      <MetricCard label={meta.requestsLabel} tone={meta.tone} value={summary.requests} />
      <MetricCard label={meta.tokenLabel} tone={meta.tone} value={summary.totalTokens} />
    </div>
  );
}

export function UsageAnalyticsSection() {
  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("30d");
  const [modelFilter, setModelFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | UsageSourceType>("all");

  async function loadUsageLogs() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const entries = await readUsageLogs();
      setLogs(entries);
      setStatus("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取用量日志失败。");
      setStatus("error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setStatus("loading");
      setErrorMessage(null);
      try {
        const entries = await readUsageLogs();
        if (cancelled) {
          return;
        }
        setLogs(entries);
        setStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "读取用量日志失败。");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const modelOptions = useMemo(() => {
    const modelIds = Array.from(new Set(logs.map((log) => log.modelId).filter(Boolean)));
    return ["all", ...modelIds];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const rangeStart = resolveRangeStart(timeRange);
    return logs.filter((log) => {
      const recordedAt = parseEpoch(log.recordedAt || log.createdAt);
      if (recordedAt < rangeStart) {
        return false;
      }
      if (modelFilter !== "all" && log.modelId !== modelFilter) {
        return false;
      }
      if (sourceFilter !== "all" && log.sourceType !== sourceFilter) {
        return false;
      }
      return true;
    });
  }, [logs, modelFilter, sourceFilter, timeRange]);

  const summary = useMemo(() => summarizeLogs(filteredLogs), [filteredLogs]);
  const chatSummary = useMemo(() => getSourceSummary(filteredLogs, "chat"), [filteredLogs]);
  const workflowSummary = useMemo(() => getSourceSummary(filteredLogs, "workflow"), [filteredLogs]);
  const expansionSummary = useMemo(() => getSourceSummary(filteredLogs, "expansion"), [filteredLogs]);

  const heatmapWeeks = useMemo(() => {
    const days = buildHeatmapDays(filteredLogs);
    const weeks: HeatmapDay[][] = [];
    for (let index = 0; index < days.length; index += HEATMAP_ROW_COUNT) {
      weeks.push(days.slice(index, index + HEATMAP_ROW_COUNT));
    }
    return weeks;
  }, [filteredLogs]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader
        title="用量统计"
        icon={<Activity className="h-4 w-4" />}
        actions={
          <SettingsHeaderResponsiveButton
            type="button"
            label="刷新用量统计"
            text="刷新"
            icon={<RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />}
            onClick={() => void loadUsageLogs()}
            disabled={status === "loading"}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="inline-flex items-center gap-2 border border-[#dbe3ee] px-3 py-2 dark:border-[#2a3038]">
              <Filter className="h-4 w-4 text-[#64748b] dark:text-zinc-400" />
              <select
                aria-label="时间范围"
                className="bg-transparent text-[#0f172a] outline-none dark:text-zinc-100"
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value as TimeRangeKey)}
              >
                <option value="7d">最近 7 天</option>
                <option value="30d">最近 30 天</option>
                <option value="90d">最近 90 天</option>
                <option value="all">全部时间</option>
              </select>
            </div>
            <div className="inline-flex items-center gap-2 border border-[#dbe3ee] px-3 py-2 dark:border-[#2a3038]">
              <DatabaseZap className="h-4 w-4 text-[#64748b] dark:text-zinc-400" />
              <select
                aria-label="模型筛选"
                className="max-w-[220px] bg-transparent text-[#0f172a] outline-none dark:text-zinc-100"
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
              >
                {modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "all" ? "全部模型" : option}
                  </option>
                ))}
              </select>
            </div>
            <div className="inline-flex items-center gap-2 border border-[#dbe3ee] px-3 py-2 dark:border-[#2a3038]">
              <Activity className="h-4 w-4 text-[#64748b] dark:text-zinc-400" />
              <select
                aria-label="模式筛选"
                className="bg-transparent text-[#0f172a] outline-none dark:text-zinc-100"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value as "all" | UsageSourceType)}
              >
                <option value="all">全部模式</option>
                <option value="chat">图书 Agent</option>
                <option value="workflow">工作流</option>
                <option value="expansion">创作台</option>
              </select>
            </div>
            <span className="text-xs text-[#94a3b8] dark:text-[#64748b]">当前日志 {formatMetric(filteredLogs.length)} 条</span>
          </div>
        </div>

        <UsageHeatmap formatMetric={formatMetric} weeks={heatmapWeeks} />

        <div className="grid border-b border-border sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="总请求数" value={summary.requests} />
          <MetricCard label="总 Tokens" value={summary.totalTokens} />
          <MetricCard label="总输入数" value={summary.inputTokens} />
          <MetricCard label="总输出数" value={summary.outputTokens} />
        </div>
        <SourceSummaryCard sourceType="chat" summary={chatSummary} />
        <SourceSummaryCard sourceType="workflow" summary={workflowSummary} />
        <SourceSummaryCard sourceType="expansion" summary={expansionSummary} />

        <div className="min-h-[320px] px-4 py-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#64748b] dark:text-zinc-400" />
            <h3 className="text-sm font-medium text-[#0f172a] dark:text-zinc-100">用量日志</h3>
          </div>
          <UsageLogTable
            errorMessage={errorMessage}
            filteredLogs={filteredLogs}
            formatDateTime={formatDateTime}
            formatMetric={formatMetric}
            status={status}
          />
        </div>
      </div>
    </section>
  );
}
