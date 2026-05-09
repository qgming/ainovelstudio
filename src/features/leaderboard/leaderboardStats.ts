import type { LeaderboardBook } from "./types";
import type { LeaderboardCategoryStat, LeaderboardStats } from "./leaderboardStatsTypes";

export type { LeaderboardCategoryStat, LeaderboardStats } from "./leaderboardStatsTypes";

type CategoryBucket = {
  books: LeaderboardBook[];
  bookCount: number;
  finishedBookCount: number;
  finishedReadCount: number;
  readCount: number;
  rankTrendRaw: number;
  risingBookCount: number;
  serialBookCount: number;
  topBook: LeaderboardBook | null;
  topReadCounts: number[];
  totalWordCount: number;
  weightedRankTrend: number;
};

function safeShare(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

function safeRatio(value: number, base: number) {
  return base > 0 ? value / base : 0;
}

function getCategoryName(book: LeaderboardBook) {
  return book.category?.trim() || "分类未知";
}

function getRankTrendWeight(book: LeaderboardBook) {
  const rankWeight = 1 / Math.sqrt(Math.max(1, book.categoryRank ?? book.rank));
  const readWeight = Math.log10(Math.max(10, book.readCount));
  return rankWeight * readWeight;
}

function getCategoryWaistBooks(books: LeaderboardBook[]) {
  const sortedBooks = [...books].sort((left, right) => {
    return (left.categoryRank ?? left.rank) - (right.categoryRank ?? right.rank);
  });
  const headCount = Math.max(1, Math.ceil(sortedBooks.length * 0.2));
  const waistEnd = Math.max(headCount, Math.floor(sortedBooks.length * 0.7));
  return sortedBooks.slice(headCount, waistEnd);
}

function getCategoryHeadBooks(books: LeaderboardBook[]) {
  const sortedBooks = [...books].sort((left, right) => {
    return (left.categoryRank ?? left.rank) - (right.categoryRank ?? right.rank);
  });
  return sortedBooks.slice(0, Math.max(1, Math.ceil(sortedBooks.length * 0.2)));
}

function createCategoryStat(name: string, bucket: CategoryBucket, stats: Pick<LeaderboardStats, "totalBooks" | "totalReadCount">) {
  const averageWordCount = bucket.bookCount > 0 ? Math.round(bucket.totalWordCount / bucket.bookCount) : 0;
  const bookShare = safeShare(bucket.bookCount, stats.totalBooks);
  const readShare = safeShare(bucket.readCount, stats.totalReadCount);
  const waistBooks = getCategoryWaistBooks(bucket.books);
  const waistReadCount = waistBooks.reduce((sum, book) => sum + Math.max(0, book.readCount), 0);
  const waistRisingBookCount = waistBooks.filter((book) => (book.rankPosDiff ?? 0) > 0).length;
  const headBooks = getCategoryHeadBooks(bucket.books);
  const headReadCount = headBooks.reduce((sum, book) => sum + Math.max(0, book.readCount), 0);
  const headRisingBookCount = headBooks.filter((book) => (book.rankPosDiff ?? 0) > 0).length;
  const top3ReadCount = bucket.topReadCounts.slice(0, 3).reduce((sum, count) => sum + count, 0);
  return {
    absorptionEfficiencyIndex: 0,
    averageReadStrengthIndex: 0,
    averageReadCount: bucket.bookCount > 0 ? Math.round(bucket.readCount / bucket.bookCount) : 0,
    averageWordCount,
    blockbusterConcentration: 0,
    bookCount: bucket.bookCount,
    bookShare,
    demandMultiplierIndex: safeRatio(readShare, bookShare),
    finishedBookCount: bucket.finishedBookCount,
    finishedBookShare: safeShare(bucket.finishedBookCount, bucket.bookCount),
    finishedReadCount: bucket.finishedReadCount,
    finishedReadShare: safeShare(bucket.finishedReadCount, bucket.readCount),
    fallingBookShare: safeShare(bucket.bookCount - bucket.risingBookCount, bucket.bookCount),
    headReadShare: safeShare(headReadCount, bucket.readCount),
    headRisingShare: safeShare(headRisingBookCount, headBooks.length),
    hotTrendOpportunityIndex: 0,
    longTermCapacityIndex: 0,
    longTermDigestionIndex: 0,
    longFormIndex: 0,
    name,
    newWriterOpportunityIndex: 0,
    overallOpportunityIndex: 0,
    opportunityGap: 0,
    rankTrendRaw: bucket.rankTrendRaw,
    readCount: bucket.readCount,
    readPerTenThousandWords: bucket.totalWordCount > 0 ? Math.round(bucket.readCount / (bucket.totalWordCount / 10_000)) : 0,
    readShare,
    riskScore: 0,
    risingBookCount: bucket.risingBookCount,
    risingBookShare: safeShare(bucket.risingBookCount, bucket.bookCount),
    serialBookCount: bucket.serialBookCount,
    serialBookShare: safeShare(bucket.serialBookCount, bucket.bookCount),
    stableLongFormOpportunityIndex: 0,
    studySampleValueIndex: 0,
    supplyCrowdingIndex: safeRatio(bookShare, readShare),
    top3Concentration: safeShare(top3ReadCount, bucket.readCount),
    top3ReadCount,
    topBookReadCount: bucket.topBook?.readCount ?? 0,
    topBookReadIntensityIndex: safeRatio(bucket.topBook?.readCount ?? 0, stats.totalReadCount),
    topBookName: bucket.topBook?.bookName ?? "暂无代表作",
    topOnlyTrendRisk: 0,
    totalWordCount: bucket.totalWordCount,
    trendMomentumIndex: 0,
    waistBookCount: waistBooks.length,
    waistReadCount,
    waistReadShare: safeShare(waistReadCount, bucket.readCount),
    waistRisingBookCount,
    waistRisingShare: safeShare(waistRisingBookCount, waistBooks.length),
    weightedRankTrend: bucket.weightedRankTrend,
  };
}

function enrichCategoryStats(stats: LeaderboardCategoryStat[], totals: { totalReadCount: number; totalWordCount: number }) {
  const globalReadDensity = totals.totalWordCount > 0 ? totals.totalReadCount / (totals.totalWordCount / 10_000) : 0;
  const globalAverageReadCount = stats.reduce((sum, stat) => sum + stat.readCount, 0)
    / Math.max(1, stats.reduce((sum, stat) => sum + stat.bookCount, 0));
  const globalAverageWordCount = stats.reduce((sum, stat) => sum + stat.totalWordCount, 0)
    / Math.max(1, stats.reduce((sum, stat) => sum + stat.bookCount, 0));
  const maxEfficiency = Math.max(0.001, ...stats.map((stat) => {
    return globalReadDensity > 0 ? stat.readPerTenThousandWords / globalReadDensity : 0;
  }));
  const maxTop1Strength = Math.max(0.001, ...stats.map((stat) => stat.topBookReadIntensityIndex));
  const maxTop3Strength = Math.max(0.001, ...stats.map((stat) => safeRatio(stat.top3ReadCount, totals.totalReadCount)));
  const maxTrend = Math.max(0.001, ...stats.map((stat) => Math.max(0, stat.weightedRankTrend)));
  const scoredStats = stats.map((stat) => {
    const averageReadStrengthIndex = safeRatio(stat.averageReadCount, globalAverageReadCount);
    const averageWordIndex = globalAverageWordCount > 0 ? stat.averageWordCount / globalAverageWordCount : 0;
    const absorptionEfficiencyIndex = globalReadDensity > 0 ? stat.readPerTenThousandWords / globalReadDensity : 0;
    const opportunityGap = stat.readShare - stat.bookShare;
    const readDensity = absorptionEfficiencyIndex / maxEfficiency;
    const top1Strength = stat.topBookReadIntensityIndex / maxTop1Strength;
    const top3Strength = safeRatio(stat.top3ReadCount, totals.totalReadCount) / maxTop3Strength;
    const trendMomentumIndex = Math.max(0, stat.weightedRankTrend) / maxTrend;
    const blockbusterConcentration = safeShare(stat.topBookReadCount, stat.readCount);
    const topOnlyTrendRisk = getTopOnlyTrendRisk({ ...stat, blockbusterConcentration }, trendMomentumIndex);
    const longTermDigestionIndex = 0.4 * averageWordIndex + 0.25 * stat.serialBookShare + 0.2 * stat.finishedReadShare + 0.15 * absorptionEfficiencyIndex;
    const enriched = {
      ...stat,
      absorptionEfficiencyIndex,
      averageReadStrengthIndex,
      blockbusterConcentration,
      longFormIndex: averageWordIndex,
      longTermCapacityIndex: 0.6 * averageWordIndex + 0.4 * stat.serialBookShare,
      longTermDigestionIndex,
      opportunityGap,
      topOnlyTrendRisk,
      trendMomentumIndex,
    };
    return { enriched, readDensity, top1Strength, top3Strength };
  });
  const maxOpportunityGap = Math.max(0.001, ...scoredStats.map(({ enriched }) => Math.max(0, enriched.opportunityGap)));
  const maxLongTerm = Math.max(0.001, ...scoredStats.map(({ enriched }) => enriched.longTermDigestionIndex));
  return scoredStats.map(({ enriched, readDensity, top1Strength, top3Strength }) => {
    const opportunityGapScore = Math.max(0, enriched.opportunityGap) / maxOpportunityGap;
    const longTermScore = enriched.longTermDigestionIndex / maxLongTerm;
    return {
      ...enriched,
      hotTrendOpportunityIndex: getHotTrendOpportunity(enriched, readDensity),
      newWriterOpportunityIndex: getNewWriterOpportunity(enriched, readDensity),
      overallOpportunityIndex: getOverallOpportunity(enriched, opportunityGapScore, readDensity, longTermScore),
      riskScore: getRiskScore(enriched),
      stableLongFormOpportunityIndex: getStableLongFormOpportunity(enriched, readDensity, enriched.longFormIndex),
      studySampleValueIndex: getStudySampleValue(enriched, readDensity, top1Strength, top3Strength),
    };
  });
}

function getNewWriterOpportunity(stat: LeaderboardCategoryStat, readDensity: number) {
  return 0.22 * stat.waistReadShare + 0.2 * stat.waistRisingShare + 0.18 * readDensity
    + 0.16 * stat.averageReadStrengthIndex + 0.14 * stat.trendMomentumIndex
    + 0.1 * stat.readShare - 0.18 * stat.blockbusterConcentration - 0.1 * stat.top3Concentration;
}

function getHotTrendOpportunity(stat: LeaderboardCategoryStat, readDensity: number) {
  return 0.28 * stat.trendMomentumIndex + 0.22 * stat.risingBookShare + 0.2 * stat.waistRisingShare
    + 0.15 * stat.averageReadStrengthIndex + 0.15 * readDensity - 0.12 * stat.topOnlyTrendRisk;
}

function getStableLongFormOpportunity(stat: LeaderboardCategoryStat, readDensity: number, longForm: number) {
  return 0.22 * stat.waistReadShare + 0.2 * longForm + 0.18 * stat.serialBookShare
    + 0.16 * stat.finishedReadShare + 0.14 * readDensity + 0.1 * stat.averageReadStrengthIndex
    - 0.1 * stat.blockbusterConcentration;
}

function getStudySampleValue(stat: LeaderboardCategoryStat, readDensity: number, top1: number, top3: number) {
  return 0.24 * top1 + 0.2 * top3 + 0.18 * stat.readShare + 0.14 * stat.trendMomentumIndex
    + 0.12 * readDensity + 0.12 * stat.waistReadShare;
}

function getOverallOpportunity(stat: LeaderboardCategoryStat, gap: number, readDensity: number, longTerm: number) {
  return 0.35 * gap + 0.3 * readDensity + 0.2 * longTerm - 0.15 * stat.blockbusterConcentration;
}

function getTopOnlyTrendRisk(stat: LeaderboardCategoryStat, trend: number) {
  return Math.max(0, stat.headRisingShare - stat.waistRisingShare) * stat.blockbusterConcentration * Math.max(0, trend);
}

function getRiskScore(stat: LeaderboardCategoryStat) {
  const lowMiddleReadShare = Math.max(0, 0.3 - stat.waistReadShare);
  return 0.26 * stat.blockbusterConcentration + 0.2 * stat.top3Concentration
    + 0.2 * stat.topOnlyTrendRisk + 0.16 * stat.fallingBookShare + 0.14 * lowMiddleReadShare;
}

function createCategoryBucket(): CategoryBucket {
  return {
    books: [],
    bookCount: 0,
    finishedBookCount: 0,
    finishedReadCount: 0,
    readCount: 0,
    rankTrendRaw: 0,
    risingBookCount: 0,
    serialBookCount: 0,
    topBook: null,
    topReadCounts: [],
    totalWordCount: 0,
    weightedRankTrend: 0,
  };
}

function addTopReadCount(counts: number[], readCount: number) {
  counts.push(readCount);
  counts.sort((left, right) => right - left);
  if (counts.length > 5) counts.pop();
}

function collectCategoryBuckets(books: LeaderboardBook[]) {
  const buckets = new Map<string, CategoryBucket>();
  for (const book of books) {
    const name = getCategoryName(book);
    const readCount = Math.max(0, book.readCount);
    const rankDiff = book.rankPosDiff ?? 0;
    const bucket = buckets.get(name) ?? createCategoryBucket();
    bucket.bookCount += 1;
    bucket.books.push(book);
    bucket.readCount += readCount;
    bucket.rankTrendRaw += rankDiff;
    bucket.totalWordCount += Math.max(0, book.wordCount);
    bucket.weightedRankTrend += rankDiff * getRankTrendWeight(book);
    if (rankDiff > 0) bucket.risingBookCount += 1;
    if (book.status === "连载中") bucket.serialBookCount += 1;
    if (book.status === "已完结") {
      bucket.finishedBookCount += 1;
      bucket.finishedReadCount += readCount;
    }
    if (!bucket.topBook || readCount > bucket.topBook.readCount) bucket.topBook = book;
    addTopReadCount(bucket.topReadCounts, readCount);
    buckets.set(name, bucket);
  }
  return buckets;
}

export function buildLeaderboardStats(books: LeaderboardBook[]): LeaderboardStats {
  const totalBooks = books.length;
  const totalReadCount = books.reduce((sum, book) => sum + Math.max(0, book.readCount), 0);
  const totalWordCount = books.reduce((sum, book) => sum + Math.max(0, book.wordCount), 0);
  const serialBookCount = books.filter((book) => book.status === "连载中").length;
  const finishedBookCount = totalBooks - serialBookCount;
  const categoryStats = enrichCategoryStats(Array.from(collectCategoryBuckets(books))
    .map(([name, bucket]) => createCategoryStat(name, bucket, { totalBooks, totalReadCount }))
    .sort((left, right) => right.readCount - left.readCount || right.bookCount - left.bookCount), { totalReadCount, totalWordCount });
  const topTenReadCount = [...books]
    .sort((left, right) => right.readCount - left.readCount)
    .slice(0, 10)
    .reduce((sum, book) => sum + Math.max(0, book.readCount), 0);

  return {
    averageReadCount: totalBooks > 0 ? Math.round(totalReadCount / totalBooks) : 0,
    categoryStats,
    finishedBookCount,
    finishedBookShare: safeShare(finishedBookCount, totalBooks),
    serialBookCount,
    serialBookShare: safeShare(serialBookCount, totalBooks),
    topCategoryName: categoryStats[0]?.name ?? "暂无分类",
    topCategoryReadShare: categoryStats[0]?.readShare ?? 0,
    topTenReadShare: safeShare(topTenReadCount, totalReadCount),
    totalBooks,
    totalReadCount,
    totalWordCount,
  };
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}
