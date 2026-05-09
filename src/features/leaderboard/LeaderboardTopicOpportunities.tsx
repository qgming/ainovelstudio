import { formatCount } from "./leaderboardApi";
import { formatPercent, type LeaderboardCategoryStat, type LeaderboardStats } from "./leaderboardStats";
import { LineSection, MetricLabel, SplitCell, SplitGrid } from "./LeaderboardStatsSignals";

type TopicItem = {
  metric: string;
  name: string;
  reason: string;
  score: number;
};

type ScoredTopic = {
  blockbusterSample: number;
  longTerm: number;
  overall: number;
  stat: LeaderboardCategoryStat;
  undersupply: number;
};

function formatIndex(value: number) {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function FocusTopicRow({ item, maxScore }: { item: TopicItem; maxScore: number }) {
  const width = `${Math.max(2, Math.min(100, (item.score / Math.max(0.001, maxScore)) * 100))}%`;
  return (
    <div className="min-w-0 py-2 first:pt-0 last:pb-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">
          {item.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{item.reason}</span>
        </p>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{item.metric}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-subtle" aria-label={`${item.name}评分 ${item.metric}`}>
        <div className="h-full rounded-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function FocusTopicList({ infoKey, items, title }: {
  infoKey: "blockbusterSampleValue" | "opportunityOverall" | "potentialUndersupply" | "stableLongTerm";
  items: TopicItem[];
  title: string;
}) {
  const maxScore = Math.max(0.001, ...items.map((item) => item.score));
  return (
    <div className="min-w-0">
      <MetricLabel infoKey={infoKey} label={title} />
      {items.map((item) => <FocusTopicRow key={`${title}-${item.name}`} item={item} maxScore={maxScore} />)}
    </div>
  );
}

export function FocusTopics({ stats }: { stats: LeaderboardStats }) {
  const scoredTopics = buildTopicOpportunityScores(stats);
  return (
    <LineSection title="题材机会">
      <SplitGrid>
        <SplitCell><FocusTopicList infoKey="opportunityOverall" title="综合机会题材" items={scoredTopics.overall} /></SplitCell>
        <SplitCell><FocusTopicList infoKey="stableLongTerm" title="稳健长线题材" items={scoredTopics.longTerm} /></SplitCell>
        <SplitCell><FocusTopicList infoKey="blockbusterSampleValue" title="爆款样本价值" items={scoredTopics.blockbusterSample} /></SplitCell>
        <SplitCell><FocusTopicList infoKey="potentialUndersupply" title="低供给高潜力题材" items={scoredTopics.undersupply} /></SplitCell>
      </SplitGrid>
    </LineSection>
  );
}

function buildTopicOpportunityScores(stats: LeaderboardStats) {
  const maxGap = Math.max(0.001, ...stats.categoryStats.map((stat) => Math.max(0, stat.opportunityGap)));
  const maxEfficiency = Math.max(0.001, ...stats.categoryStats.map((stat) => stat.absorptionEfficiencyIndex));
  const maxLongTerm = Math.max(0.001, ...stats.categoryStats.map((stat) => stat.longTermDigestionIndex));
  const maxTopIntensity = Math.max(0.001, ...stats.categoryStats.map((stat) => stat.topBookReadIntensityIndex));
  const scored = stats.categoryStats.map((stat) => createScoredTopic(stat, maxGap, maxEfficiency, maxLongTerm, maxTopIntensity));
  return {
    blockbusterSample: toTopicItems(scored, "blockbusterSample", "blockbusterSample"),
    longTerm: toTopicItems(scored, "longTerm", "longTerm"),
    overall: toTopicItems(scored, "overall", "overall"),
    undersupply: toTopicItems(scored, "undersupply", "undersupply"),
  };
}

function createScoredTopic(stat: LeaderboardCategoryStat, maxGap: number, maxEfficiency: number, maxLongTerm: number, maxTopIntensity: number) {
  const gap = Math.max(0, stat.opportunityGap) / maxGap;
  const efficiency = stat.absorptionEfficiencyIndex / maxEfficiency;
  const longTerm = stat.longTermDigestionIndex / maxLongTerm;
  const topIntensity = stat.topBookReadIntensityIndex / maxTopIntensity;
  return {
    blockbusterSample: 0.4 * topIntensity + 0.25 * stat.blockbusterConcentration + 0.2 * stat.readShare + 0.15 * efficiency,
    longTerm: 0.45 * longTerm + 0.25 * efficiency + 0.2 * stat.serialBookShare + 0.1 * stat.readShare,
    overall: 0.35 * gap + 0.3 * efficiency + 0.2 * longTerm - 0.15 * stat.blockbusterConcentration,
    stat,
    undersupply: 0.5 * gap + 0.35 * efficiency - 0.15 * stat.bookShare,
  };
}

function toTopicItems(scored: ScoredTopic[], key: keyof ScoredTopicScore, mode: TopicMode) {
  return [...scored]
    .sort((left, right) => right[key] - left[key])
    .slice(0, 5)
    .map(({ stat, [key]: score }) => ({
      metric: score.toFixed(2).replace(/\.?0+$/, ""),
      name: stat.name,
      reason: getOpportunityReason(stat, mode),
      score,
    }));
}

type ScoredTopicScore = Omit<ScoredTopic, "stat">;
type TopicMode = keyof ScoredTopicScore;

function getOpportunityReason(stat: LeaderboardCategoryStat, mode: TopicMode) {
  if (mode === "longTerm") return `均字 ${formatCount(stat.averageWordCount)} · 连载 ${formatPercent(stat.serialBookShare)}`;
  if (mode === "blockbusterSample") return `Top1 ${formatPercent(stat.blockbusterConcentration)} · ${stat.topBookName}`;
  if (mode === "undersupply") return `缺口 +${formatPercent(Math.max(0, stat.opportunityGap))} · 数量 ${formatPercent(stat.bookShare)}`;
  return `缺口 +${formatPercent(Math.max(0, stat.opportunityGap))} · 吸量 ${formatIndex(stat.absorptionEfficiencyIndex)}`;
}
