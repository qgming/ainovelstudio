import { useEffect, useMemo, useState } from "react";
import { Activity, DatabaseZap, Filter, History, RefreshCw } from "lucide-react";
import { readUsageLogs } from "../../lib/usage/api";
import type { UsageLogEntry } from "../../lib/usage/types";
import { UsageHeatmap } from "./UsageHeatmap";
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

function toDateKey(value: string) {
  return new Date(parseEpoch(value)).toISOString().slice(0, 10);
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

function buildHeatmapDays(logs: UsageLogEntry[]) {
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
    const dateKey = current.toISOString().slice(0, 10);
    const dayEntry = byDay.get(dateKey) ?? { requestCount: 0, tokenTotal: 0 };
    const normalized = maxCount <= 0 ? 0 : Math.ceil((dayEntry.requestCount / maxCount) * 4);
    days.push({
      dateKey,
      dayLabel: current.toLocaleDateString("zh-CN", { day: "2-digit", month: "2-digit" }),
      level: Math.min(4, normalized) as HeatmapDay["level"],
      requestCount: dayEntry.requestCount,
      tokenTotal: dayEntry.tokenTotal,
    });
  }

  return days;
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="border-r border-b border-[#e2e8f0] px-4 py-4 last:border-r-0 dark:border-[#20242b]">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#94a3b8] dark:text-[#64748b]">{label}</p>
      <p className="mt-3 text-[26px] font-semibold tracking-[-0.05em] text-[#0f172a] dark:text-white">
        {formatMetric(value)}
      </p>
    </div>
  );
}

export function UsageAnalyticsSection() {
  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("30d");
  const [modelFilter, setModelFilter] = useState("all");

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
      return true;
    });
  }, [logs, modelFilter, timeRange]);

  const summary = useMemo(() => {
    return filteredLogs.reduce(
      (accumulator, log) => ({
        requests: accumulator.requests + 1,
        totalTokens: accumulator.totalTokens + log.totalTokens,
        inputTokens: accumulator.inputTokens + log.inputTokens,
        outputTokens: accumulator.outputTokens + log.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0 },
    );
  }, [filteredLogs]);

  const heatmapWeeks = useMemo(() => {
    const days = buildHeatmapDays(filteredLogs);
    const weeks: HeatmapDay[][] = [];
    for (let index = 0; index < days.length; index += HEATMAP_ROW_COUNT) {
      weeks.push(days.slice(index, index + HEATMAP_ROW_COUNT));
    }
    return weeks;
  }, [filteredLogs]);

  return (
    <section className="min-h-full border-b border-[#e2e8f0] dark:border-[#20242b]">
      <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-4 dark:border-[#20242b]">
        <div className="flex items-center gap-2 text-[#111827] dark:text-[#f3f4f6]">
          <Activity className="h-4 w-4" />
          <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">用量统计</h2>
        </div>
        <button
          type="button"
          aria-label="刷新用量统计"
          onClick={() => void loadUsageLogs()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#d7dde8] text-[#475569] transition-colors hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
          disabled={status === "loading"}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="border-b border-[#e2e8f0] px-4 py-3 dark:border-[#20242b]">
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
          <span className="text-xs text-[#94a3b8] dark:text-[#64748b]">当前日志 {formatMetric(filteredLogs.length)} 条</span>
        </div>
      </div>

      <UsageHeatmap formatMetric={formatMetric} weeks={heatmapWeeks} />

      <div className="grid border-b border-[#e2e8f0] sm:grid-cols-2 xl:grid-cols-4 dark:border-[#20242b]">
        <MetricCard label="总请求数" value={summary.requests} />
        <MetricCard label="总 Tokens" value={summary.totalTokens} />
        <MetricCard label="总输入数" value={summary.inputTokens} />
        <MetricCard label="总输出数" value={summary.outputTokens} />
      </div>

      <div className="min-h-[320px] px-4 py-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[#64748b] dark:text-zinc-400" />
          <h3 className="text-sm font-medium text-[#0f172a] dark:text-zinc-100">对话日志</h3>
        </div>
        <UsageLogTable
          errorMessage={errorMessage}
          filteredLogs={filteredLogs}
          formatDateTime={formatDateTime}
          formatMetric={formatMetric}
          status={status}
        />
      </div>
    </section>
  );
}
