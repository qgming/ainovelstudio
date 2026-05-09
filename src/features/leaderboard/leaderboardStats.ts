import type { LeaderboardBook } from "./types";

export type LeaderboardCategoryStat = {
  absorptionEfficiencyIndex: number;
  averageReadCount: number;
  averageWordCount: number;
  blockbusterConcentration: number;
  bookCount: number;
  bookShare: number;
  demandMultiplierIndex: number;
  finishedBookCount: number;
  finishedBookShare: number;
  finishedReadCount: number;
  finishedReadShare: number;
  longTermCapacityIndex: number;
  longTermDigestionIndex: number;
  midTierReadCount: number;
  midTierReadShare: number;
  name: string;
  opportunityGap: number;
  readCount: number;
  readPerTenThousandWords: number;
  readShare: number;
  serialBookCount: number;
  serialBookShare: number;
  supplyCrowdingIndex: number;
  topBookReadCount: number;
  topBookReadIntensityIndex: number;
  topBookName: string;
  totalWordCount: number;
};

export type LeaderboardStats = {
  averageReadCount: number;
  categoryStats: LeaderboardCategoryStat[];
  finishedBookCount: number;
  finishedBookShare: number;
  serialBookCount: number;
  serialBookShare: number;
  topCategoryName: string;
  topCategoryReadShare: number;
  topTenReadShare: number;
  totalBooks: number;
  totalReadCount: number;
  totalWordCount: number;
};

type CategoryBucket = {
  bookCount: number;
  finishedBookCount: number;
  finishedReadCount: number;
  readCount: number;
  serialBookCount: number;
  topBook: LeaderboardBook | null;
  topReadCounts: number[];
  totalWordCount: number;
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

function createCategoryStat(name: string, bucket: CategoryBucket, stats: Pick<LeaderboardStats, "totalBooks" | "totalReadCount">) {
  const averageWordCount = bucket.bookCount > 0 ? Math.round(bucket.totalWordCount / bucket.bookCount) : 0;
  const bookShare = safeShare(bucket.bookCount, stats.totalBooks);
  const readShare = safeShare(bucket.readCount, stats.totalReadCount);
  const midTierReadCount = bucket.topReadCounts.slice(1, 5).reduce((sum, count) => sum + count, 0);
  return {
    absorptionEfficiencyIndex: 0,
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
    longTermCapacityIndex: 0,
    longTermDigestionIndex: 0,
    midTierReadCount,
    midTierReadShare: safeShare(midTierReadCount, bucket.readCount),
    name,
    opportunityGap: 0,
    readCount: bucket.readCount,
    readPerTenThousandWords: bucket.totalWordCount > 0 ? Math.round(bucket.readCount / (bucket.totalWordCount / 10_000)) : 0,
    readShare,
    serialBookCount: bucket.serialBookCount,
    serialBookShare: safeShare(bucket.serialBookCount, bucket.bookCount),
    supplyCrowdingIndex: safeRatio(bookShare, readShare),
    topBookReadCount: bucket.topBook?.readCount ?? 0,
    topBookReadIntensityIndex: safeRatio(bucket.topBook?.readCount ?? 0, stats.totalReadCount),
    topBookName: bucket.topBook?.bookName ?? "暂无代表作",
    totalWordCount: bucket.totalWordCount,
  };
}

function enrichCategoryStats(stats: LeaderboardCategoryStat[], totals: { totalReadCount: number; totalWordCount: number }) {
  const globalReadDensity = totals.totalWordCount > 0 ? totals.totalReadCount / (totals.totalWordCount / 10_000) : 0;
  const globalAverageWordCount = stats.reduce((sum, stat) => sum + stat.totalWordCount, 0)
    / Math.max(1, stats.reduce((sum, stat) => sum + stat.bookCount, 0));
  return stats.map((stat) => {
    const averageWordIndex = globalAverageWordCount > 0 ? stat.averageWordCount / globalAverageWordCount : 0;
    const absorptionEfficiencyIndex = globalReadDensity > 0 ? stat.readPerTenThousandWords / globalReadDensity : 0;
    return {
      ...stat,
      absorptionEfficiencyIndex,
      blockbusterConcentration: safeShare(stat.topBookReadCount, stat.readCount),
      longTermCapacityIndex: 0.6 * averageWordIndex + 0.4 * stat.serialBookShare,
      longTermDigestionIndex: 0.4 * averageWordIndex + 0.25 * stat.serialBookShare + 0.2 * stat.finishedReadShare + 0.15 * absorptionEfficiencyIndex,
      opportunityGap: stat.readShare - stat.bookShare,
    };
  });
}

function createCategoryBucket(): CategoryBucket {
  return {
    bookCount: 0,
    finishedBookCount: 0,
    finishedReadCount: 0,
    readCount: 0,
    serialBookCount: 0,
    topBook: null,
    topReadCounts: [],
    totalWordCount: 0,
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
    const bucket = buckets.get(name) ?? createCategoryBucket();
    bucket.bookCount += 1;
    bucket.readCount += readCount;
    bucket.totalWordCount += Math.max(0, book.wordCount);
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
