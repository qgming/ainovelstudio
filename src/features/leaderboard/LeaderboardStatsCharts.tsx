import { formatCount } from "./leaderboardApi";
import { InterestSignals, LineSection, SplitCell, SplitGrid } from "./LeaderboardStatsSignals";
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

function getDemandGap(stat: LeaderboardCategoryStat) {
  return stat.readShare - stat.bookShare;
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
  const topGap = [...stats.categoryStats].sort((left, right) => getDemandGap(right) - getDemandGap(left))[0];
  return (
    <section className="border-b border-border bg-panel">
      <div className="grid grid-cols-2 divide-border sm:grid-cols-5">
        <CompactMetric label="入榜作品" value={`${stats.totalBooks} 本`} detail={`${stats.categoryStats.length} 个子分类`} />
        <CompactMetric label="总在读数" value={formatCount(stats.totalReadCount)} detail={`平均 ${formatCount(stats.averageReadCount)}`} />
        <CompactMetric label="头部题材" value={stats.topCategoryName} detail={`阅读占比 ${formatPercent(stats.topCategoryReadShare)}`} />
        <CompactMetric label="供需缺口" value={topGap?.name ?? "暂无"} detail={topGap ? `+${formatPercent(Math.max(0, getDemandGap(topGap)))}` : "暂无差异"} />
        <CompactMetric label="前十集中度" value={formatPercent(stats.topTenReadShare)} detail="前十作品阅读份额" />
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
      <LineSection title="分类占比">
        <SplitGrid>
          <SplitCell>
            <PiePanel ariaLabel="子分类数量占比饼状图" slices={bookSlices} title="分类数量占比" />
          </SplitCell>
          <SplitCell>
            <PiePanel ariaLabel="子分类在读占比饼状图" slices={readSlices} title="分类在读占比" />
          </SplitCell>
        </SplitGrid>
      </LineSection>
      <div>
        <InterestSignals stats={stats} />
        <FocusTopics stats={stats} />
      </div>
    </>
  );
}
