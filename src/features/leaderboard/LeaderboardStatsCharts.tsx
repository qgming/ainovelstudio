import { LineSection, SplitCell, SplitGrid } from "./LeaderboardStatsSignals";
import { FocusTopics } from "./LeaderboardTopicOpportunities";
import { formatPercent, type LeaderboardCategoryStat, type LeaderboardStats } from "./leaderboardStats";

type ChartSlice = {
  color: string;
  label: string;
  value: number;
};

const CHART_COLORS = [
  "var(--primary)",
  "oklch(0.62 0.16 160)",
  "oklch(0.68 0.14 75)",
  "oklch(0.62 0.18 320)",
  "oklch(0.58 0.14 30)",
  "var(--muted-foreground)",
];

function getChartColor(index: number) {
  return CHART_COLORS[index] ?? `hsl(${(index * 47) % 360} 68% 52%)`;
}

function formatScore(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatBookTitle(name: string) {
  if (!name || name === "暂无代表作") return name;
  return name.startsWith("《") && name.endsWith("》") ? name : `《${name}》`;
}

function pickTop(stats: LeaderboardStats, key: keyof LeaderboardCategoryStat) {
  return [...stats.categoryStats].sort((left, right) => {
    const leftValue = Number(left[key]);
    const rightValue = Number(right[key]);
    return rightValue - leftValue || right.readCount - left.readCount;
  })[0];
}

function getCategorySlices(stats: LeaderboardStats, valueKey: "bookShare" | "readShare"): ChartSlice[] {
  return stats.categoryStats.map((stat, index) => ({
    color: getChartColor(index),
    label: stat.name,
    value: stat[valueKey],
  })).filter((slice) => slice.value > 0);
}

function CompactMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-border px-3 py-2 last:border-r-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold leading-6 text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function MetricsStrip({ stats }: { stats: LeaderboardStats }) {
  const newbie = pickTop(stats, "newWriterOpportunityIndex");
  const trend = pickTop(stats, "hotTrendOpportunityIndex");
  const stable = pickTop(stats, "stableLongFormOpportunityIndex");
  const sample = pickTop(stats, "studySampleValueIndex");
  const risk = pickTop(stats, "riskScore");
  return (
    <section className="border-b border-border bg-panel">
      <div className="grid grid-cols-2 divide-border sm:grid-cols-5">
        <CompactMetric label="新手友好题材" value={newbie?.name ?? "暂无"} detail={newbie ? `机会 ${formatScore(newbie.newWriterOpportunityIndex)}` : "暂无数据"} />
        <CompactMetric label="短期热度题材" value={trend?.name ?? "暂无"} detail={trend ? `热度 ${formatScore(trend.hotTrendOpportunityIndex)}` : "暂无数据"} />
        <CompactMetric label="稳健长篇题材" value={stable?.name ?? "暂无"} detail={stable ? `长线 ${formatScore(stable.stableLongFormOpportunityIndex)}` : "暂无数据"} />
        <CompactMetric label="拆书样本" value={sample ? formatBookTitle(sample.topBookName) : "暂无"} detail={sample ? `${sample.name} · ${formatScore(sample.studySampleValueIndex)}` : "暂无数据"} />
        <CompactMetric label="风险预警题材" value={risk?.name ?? "暂无"} detail={risk ? `风险 ${formatScore(risk.riskScore)}` : "暂无数据"} />
      </div>
    </section>
  );
}

function DonutChart({ ariaLabel, slices }: { ariaLabel: string; slices: ChartSlice[] }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel} className="h-48 w-48">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--panel-subtle)" strokeWidth="16" />
      {slices.map((slice) => {
        const dash = slice.value * circumference;
        const strokeDashoffset = -offset * circumference;
        offset += slice.value;
        return (
          <circle
            key={slice.label}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={strokeDashoffset}
            strokeWidth="16"
            transform="rotate(-90 60 60)"
          />
        );
      })}
      <circle cx="60" cy="60" r="27" fill="var(--panel)" />
    </svg>
  );
}

function PiePanel({ ariaLabel, slices, title }: { ariaLabel: string; slices: ChartSlice[]; title: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="flex items-center justify-center">
          <DonutChart ariaLabel={ariaLabel} slices={slices} />
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1 self-center">
          {slices.map((slice) => (
            <div key={slice.label} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />
              <span className="truncate text-muted-foreground">{slice.label}</span>
              <span className="font-medium tabular-nums text-foreground">{formatPercent(slice.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LeaderboardStatsOverview({ stats }: { stats: LeaderboardStats }) {
  const bookSlices = getCategorySlices(stats, "bookShare");
  const readSlices = getCategorySlices(stats, "readShare");
  return (
    <>
      <MetricsStrip stats={stats} />
      <FocusTopics stats={stats} />
      <LineSection title="样本结构">
        <SplitGrid>
          <SplitCell>
            <PiePanel ariaLabel="子分类数量占比饼状图" slices={bookSlices} title="分类数量占比" />
          </SplitCell>
          <SplitCell>
            <PiePanel ariaLabel="子分类在读占比饼状图" slices={readSlices} title="分类在读占比" />
          </SplitCell>
        </SplitGrid>
      </LineSection>
    </>
  );
}
