import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, CalendarDays, DatabaseZap, Download, Filter, History, RefreshCw, Upload, Zap } from "lucide-react";
import { readUsageLogs } from "@features/settings/usage/api";
import type { UsageLogEntry } from "@features/settings/usage/types";
import { UsageHeatmap } from "./UsageHeatmap";
import { SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";
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
const EMPTY_USAGE_SUMMARY: UsageSummary = {
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  noCacheTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
};

type UsageSummary = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

type UsageDailyStat = {
  dateKey: string;
  requestCount: number;
  tokenTotal: number;
};

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

function formatDateTime(value: string) {
  return timeFormatter.format(new Date(parseEpoch(value)));
}

function formatMetric(value: number) {
  return numberFormatter.format(value);
}

export function formatSemanticTokenCount(value: number) {
  const absValue = Math.abs(value);
  const units = [
    { label: "亿", value: 100_000_000 },
    { label: "千万", value: 10_000_000 },
    { label: "百万", value: 1_000_000 },
  ];
  const unit = units.find((candidate) => absValue >= candidate.value);

  if (!unit) {
    return "";
  }

  return `≈ ${(value / unit.value).toFixed(2)} ${unit.label} tokens`;
}

export function buildUsageSummaryFromLogs(logs: UsageLogEntry[]) {
  return logs.reduce<UsageSummary>(
    (summary, log) => ({
      requestCount: summary.requestCount + 1,
      inputTokens: summary.inputTokens + log.inputTokens,
      outputTokens: summary.outputTokens + log.outputTokens,
      totalTokens: summary.totalTokens + log.totalTokens,
      noCacheTokens: summary.noCacheTokens + log.noCacheTokens,
      cacheReadTokens: summary.cacheReadTokens + log.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens + log.cacheWriteTokens,
      reasoningTokens: summary.reasoningTokens + log.reasoningTokens,
    }),
    { ...EMPTY_USAGE_SUMMARY },
  );
}

export function buildDailyStatsFromLogs(logs: UsageLogEntry[]) {
  const byDay = new Map<string, UsageDailyStat>();

  for (const log of logs) {
    const dateKey = toLocalDateKey(new Date(parseEpoch(log.recordedAt || log.createdAt)));
    const current = byDay.get(dateKey) ?? {
      dateKey,
      requestCount: 0,
      tokenTotal: 0,
    };

    byDay.set(dateKey, {
      dateKey,
      requestCount: current.requestCount + 1,
      tokenTotal: current.tokenTotal + log.totalTokens,
    });
  }

  return Array.from(byDay.values());
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

export function buildHeatmapDays(stats: UsageDailyStat[]) {
  const byDay = new Map<string, { requestCount: number; tokenTotal: number }>();
  for (const stat of stats) {
    byDay.set(stat.dateKey, {
      requestCount: stat.requestCount,
      tokenTotal: stat.tokenTotal,
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
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[8px] border border-border/45 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium tracking-[-0.02em] text-foreground tabular-nums">
        {formatMetric(value)}
      </p>
    </div>
  );
}

function TotalMetricCard({ value }: { value: number }) {
  const semanticValue = formatSemanticTokenCount(value);

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">总消耗数</p>
      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
        <p className="text-[42px] font-semibold leading-none tracking-[-0.06em] text-foreground tabular-nums">
          {formatMetric(value)}
        </p>
        {semanticValue ? (
          <p className="pb-1 text-sm font-medium text-muted-foreground tabular-nums">
            {semanticValue}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function UsagePanelSection({
  actions,
  children,
  icon,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      <div className="flex min-h-10 flex-col gap-3 px-3 pt-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 text-muted-foreground">{icon}</span>
          <h3 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">{title}</h3>
        </div>
        {actions ? <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function UsageAnalyticsSection() {
  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("all");
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

  const filteredSummary = useMemo(() => buildUsageSummaryFromLogs(filteredLogs), [filteredLogs]);

  const heatmapWeeks = useMemo(() => {
    const days = buildHeatmapDays(buildDailyStatsFromLogs(filteredLogs));
    const weeks: HeatmapDay[][] = [];
    for (let index = 0; index < days.length; index += HEATMAP_ROW_COUNT) {
      weeks.push(days.slice(index, index + HEATMAP_ROW_COUNT));
    }
    return weeks;
  }, [filteredLogs]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <div className="space-y-2">
          <UsagePanelSection
            title="用量统计"
            icon={<Activity className="h-4 w-4" />}
            actions={
              <>
                <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/55 bg-panel px-3 text-[13px] text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <select
                    aria-label="时间范围"
                    className="bg-transparent outline-none"
                    value={timeRange}
                    onChange={(event) => setTimeRange(event.target.value as TimeRangeKey)}
                  >
                    <option value="7d">最近 7 天</option>
                    <option value="30d">最近 30 天</option>
                    <option value="90d">最近 90 天</option>
                    <option value="all">全部时间</option>
                  </select>
                </div>
                <div className="inline-flex h-9 min-w-0 items-center gap-2 rounded-xl border border-border/55 bg-panel px-3 text-[13px] text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
                  <DatabaseZap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <select
                    aria-label="模型筛选"
                    className="max-w-[220px] min-w-0 bg-transparent outline-none"
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
                <SettingsHeaderResponsiveButton
                  type="button"
                  label="刷新用量统计"
                  text="刷新"
                  icon={<RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />}
                  onClick={() => void loadUsageLogs()}
                  disabled={status === "loading"}
                />
              </>
            }
          >
            <div className="space-y-3 px-4 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5">
              <TotalMetricCard value={filteredSummary.totalTokens} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard icon={<Activity className="h-3.5 w-3.5" />} label="请求数" value={filteredSummary.requestCount} />
                <MetricCard icon={<Upload className="h-3.5 w-3.5" />} label="输入数" value={filteredSummary.inputTokens} />
                <MetricCard icon={<Download className="h-3.5 w-3.5" />} label="输出数" value={filteredSummary.outputTokens} />
                <MetricCard icon={<DatabaseZap className="h-3.5 w-3.5" />} label="缓存创建" value={filteredSummary.cacheWriteTokens} />
                <MetricCard icon={<Zap className="h-3.5 w-3.5" />} label="缓存命中" value={filteredSummary.cacheReadTokens} />
              </div>
            </div>
          </UsagePanelSection>

          <UsagePanelSection title="热力图" icon={<CalendarDays className="h-4 w-4" />}>
            <UsageHeatmap formatMetric={formatMetric} weeks={heatmapWeeks} />
          </UsagePanelSection>

          <UsagePanelSection title="用量日志" icon={<History className="h-4 w-4" />}>
            <div className="min-h-[320px] px-4 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5">
              <UsageLogTable
                errorMessage={errorMessage}
                filteredLogs={filteredLogs}
                formatDateTime={formatDateTime}
                formatMetric={formatMetric}
                status={status}
              />
            </div>
          </UsagePanelSection>
        </div>
      </div>
    </section>
  );
}
