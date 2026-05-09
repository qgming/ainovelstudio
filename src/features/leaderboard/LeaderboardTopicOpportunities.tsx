import type { LeaderboardCategoryStat, LeaderboardStats } from "./leaderboardStats";
import { LineSection, MetricLabel, SplitCell, SplitGrid } from "./LeaderboardStatsSignals";

const OPPORTUNITY_LIMIT = 8;

type TopicItem = {
  metric: string;
  name: string;
  reason: string;
  score: number;
};

type ScoredTopic = {
  hotTrend: number;
  newWriter: number;
  overall: number;
  risk: number;
  stableLongForm: number;
  studySample: number;
  stat: LeaderboardCategoryStat;
};

function formatBookTitle(name: string) {
  if (!name || name === "暂无代表作") return name;
  return name.startsWith("《") && name.endsWith("》") ? name : `《${name}》`;
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
        <span className="shrink-0 text-xs font-semibold text-foreground">{item.metric}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-subtle" aria-label={`${item.name}评分 ${item.metric}`}>
        <div className="h-full rounded-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function FocusTopicList({ infoKey, items, title }: {
  infoKey: "hotTrendOpportunity" | "newWriterOpportunity" | "opportunityOverall" | "stableLongFormOpportunity" | "studySampleValue" | "topicRisk";
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
    <LineSection title="题材机会榜">
      <OpportunityBoard stats={stats} />
      <div className="border-t border-border">
        <SplitGrid>
          <SplitCell><FocusTopicList infoKey="opportunityOverall" title="综合机会题材" items={scoredTopics.overall} /></SplitCell>
          <SplitCell><FocusTopicList infoKey="newWriterOpportunity" title="新手友好题材" items={scoredTopics.newWriter} /></SplitCell>
          <SplitCell><FocusTopicList infoKey="hotTrendOpportunity" title="短期热度题材" items={scoredTopics.hotTrend} /></SplitCell>
          <SplitCell><FocusTopicList infoKey="stableLongFormOpportunity" title="稳健长篇题材" items={scoredTopics.stableLongForm} /></SplitCell>
          <SplitCell><FocusTopicList infoKey="studySampleValue" title="拆书样本题材" items={scoredTopics.studySample} /></SplitCell>
          <SplitCell><FocusTopicList infoKey="topicRisk" title="风险预警题材" items={scoredTopics.risk} /></SplitCell>
        </SplitGrid>
      </div>
    </LineSection>
  );
}

function OpportunityBoard({ stats }: { stats: LeaderboardStats }) {
  const topics = getOpportunityRows(stats);
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="overflow-hidden rounded-md border border-border">
        <div className="hidden grid-cols-[minmax(120px,1.15fr)_repeat(5,minmax(92px,0.85fr))_minmax(120px,1fr)] gap-2 border-b border-border bg-panel-subtle px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid">
          <span>题材</span>
          <span>机会判断</span>
          <span>热度变化</span>
          <span>承接结构</span>
          <span>竞争风险</span>
          <span>写作空间</span>
          <span>代表作</span>
        </div>
        <div className="divide-y divide-border">
          {topics.map((stat) => <OpportunityRow key={stat.name} stat={stat} />)}
        </div>
      </div>
    </div>
  );
}

function OpportunityRow({ stat }: { stat: LeaderboardCategoryStat }) {
  return (
    <div className="grid gap-3 px-3 py-3 text-sm lg:grid-cols-[minmax(120px,1.15fr)_repeat(5,minmax(92px,0.85fr))_minmax(120px,1fr)] lg:items-center lg:gap-2">
      <div className="min-w-0">
        <p className="truncate font-semibold text-foreground">{stat.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground lg:hidden">代表作：{formatBookTitle(stat.topBookName)}</p>
      </div>
      <OpportunityValue label="机会判断" value={describeOpportunity(stat.newWriterOpportunityIndex)} strong />
      <OpportunityValue label="热度变化" value={describeTrend(stat.trendMomentumIndex)} />
      <OpportunityValue label="承接结构" value={describeWaist(stat.waistReadShare)} />
      <OpportunityValue label="竞争风险" value={describeConcentration(stat.top3Concentration)} />
      <OpportunityValue label="写作空间" value={describeWritingSpace(stat)} />
      <p className="hidden truncate text-xs text-muted-foreground lg:block">{formatBookTitle(stat.topBookName)}</p>
    </div>
  );
}

function OpportunityValue({ label, strong, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 lg:block">
      <span className="text-xs text-muted-foreground lg:hidden">{label}</span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground"}>
        {value}
      </span>
    </div>
  );
}

function getOpportunityRows(stats: LeaderboardStats) {
  return [...stats.categoryStats]
    .sort((left, right) => {
      return right.newWriterOpportunityIndex - left.newWriterOpportunityIndex || right.readCount - left.readCount;
    })
    .slice(0, OPPORTUNITY_LIMIT);
}

function buildTopicOpportunityScores(stats: LeaderboardStats) {
  const scored = stats.categoryStats.map(createScoredTopic);
  return {
    hotTrend: toTopicItems(scored, "hotTrend", "hotTrend"),
    newWriter: toTopicItems(scored, "newWriter", "newWriter"),
    overall: toTopicItems(scored, "overall", "overall"),
    risk: toTopicItems(scored, "risk", "risk"),
    stableLongForm: toTopicItems(scored, "stableLongForm", "stableLongForm"),
    studySample: toTopicItems(scored, "studySample", "studySample"),
  };
}

function createScoredTopic(stat: LeaderboardCategoryStat) {
  return {
    hotTrend: stat.hotTrendOpportunityIndex,
    newWriter: stat.newWriterOpportunityIndex,
    overall: stat.overallOpportunityIndex,
    risk: stat.riskScore,
    stableLongForm: stat.stableLongFormOpportunityIndex,
    stat,
    studySample: stat.studySampleValueIndex,
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
    })).map((item) => ({
      ...item,
      metric: getTopicVerdict(item.score, mode),
    }));
}

type ScoredTopicScore = Omit<ScoredTopic, "stat">;
type TopicMode = keyof ScoredTopicScore;

function getOpportunityReason(stat: LeaderboardCategoryStat, mode: TopicMode) {
  if (mode === "hotTrend") return `${describeTrend(stat.trendMomentumIndex)} · ${describeRising(stat.risingBookShare)}`;
  if (mode === "overall") return `${describeReadShare(stat.readShare)} · ${describeEfficiency(stat.absorptionEfficiencyIndex)}`;
  if (mode === "stableLongForm") return `${describeLongForm(stat.longFormIndex)} · ${describeSerial(stat.serialBookShare)}`;
  if (mode === "studySample") return `样本 ${formatBookTitle(stat.topBookName)} · ${describeConcentration(stat.top3Concentration)}`;
  if (mode === "risk") return getRiskReason(stat);
  return `${describeWaist(stat.waistReadShare)} · ${describeReadShare(stat.readShare)}`;
}

function getRiskReason(stat: LeaderboardCategoryStat) {
  if (stat.blockbusterConcentration > 0.5) return `单本拉动 · ${formatBookTitle(stat.topBookName)}`;
  if (stat.top3Concentration > 0.65) return "头部过强 · 跟写谨慎";
  return `${describeTrend(stat.trendMomentumIndex)} · ${describeRising(stat.risingBookShare)}`;
}

function getTopicVerdict(score: number, mode: TopicMode) {
  if (mode === "risk") return score >= 0.5 ? "高风险" : score >= 0.32 ? "需复核" : "风险可控";
  if (mode === "studySample") return score >= 0.58 ? "优先拆解" : score >= 0.38 ? "值得参考" : "样本一般";
  if (mode === "hotTrend") return score >= 0.5 ? "明显升温" : score >= 0.3 ? "正在观察" : "热度一般";
  if (mode === "stableLongForm") return score >= 0.55 ? "长线稳" : score >= 0.35 ? "可写长" : "长线弱";
  if (mode === "overall") return score >= 0.5 ? "优先研究" : score >= 0.3 ? "可观察" : "暂缓";
  return describeOpportunity(score);
}

function describeOpportunity(score: number) {
  if (score >= 0.45) return "优先研究";
  if (score >= 0.28) return "可以观察";
  if (score >= 0.12) return "谨慎试探";
  return "暂缓跟进";
}

function describeTrend(value: number) {
  if (value >= 0.7) return "升温明显";
  if (value >= 0.35) return "有升温";
  if (value > 0) return "小幅波动";
  return "未见升温";
}

function describeWaist(value: number) {
  if (value >= 0.45) return "中段健康";
  if (value >= 0.28) return "有承接";
  if (value > 0) return "承接偏弱";
  return "缺少中段";
}

function describeConcentration(value: number) {
  if (value >= 0.7) return "头部很集中";
  if (value >= 0.5) return "头部偏集中";
  if (value >= 0.3) return "竞争适中";
  return "头部分散";
}

function describeEfficiency(value: number) {
  if (value >= 1.25) return "吸量偏强";
  if (value >= 0.9) return "吸量正常";
  if (value > 0) return "吸量偏弱";
  return "字数不足";
}

function describeLongForm(value: number) {
  if (value >= 1.25) return "长篇空间大";
  if (value >= 0.9) return "可写长篇";
  if (value > 0) return "篇幅偏短";
  return "字数不足";
}

function describeSerial(value: number) {
  if (value >= 0.7) return "连载活跃";
  if (value >= 0.4) return "连载稳定";
  return "完结偏多";
}

function describeReadShare(value: number) {
  if (value >= 0.18) return "读者盘大";
  if (value >= 0.08) return "读者稳定";
  if (value > 0) return "小众读者";
  return "读者不足";
}

function describeRising(value: number) {
  if (value >= 0.6) return "多书上涨";
  if (value >= 0.3) return "部分上涨";
  if (value > 0) return "少量上涨";
  return "上涨不足";
}

function describeWritingSpace(stat: LeaderboardCategoryStat) {
  if (stat.longFormIndex >= 1.15 && stat.absorptionEfficiencyIndex >= 0.9) return "适合长线";
  if (stat.absorptionEfficiencyIndex >= 1.2) return "开篇好验证";
  if (stat.longFormIndex >= 1.15) return "能写长篇";
  return "先短测";
}
