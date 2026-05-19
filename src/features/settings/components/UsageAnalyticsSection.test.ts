import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHeatmapColumns, buildHeatmapDays, formatSemanticTokenCount, resolveHeatmapLevel, toLocalDateKey } from "./UsageAnalyticsSection";

type UsageDailyStat = Parameters<typeof buildHeatmapDays>[0][number];

function createDailyStat(overrides: Partial<UsageDailyStat> = {}): UsageDailyStat {
  return {
    dateKey: "1970-01-01",
    requestCount: 1,
    tokenTotal: 15,
    ...overrides,
  };
}

describe("UsageAnalyticsSection helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("使用本地日期而不是 UTC 日期生成 key", () => {
    const date = new Date(2026, 3, 12, 0, 30, 0);
    expect(toLocalDateKey(date)).toBe("2026-04-12");
  });

  it("只有一条请求时也返回最浅的非零热力等级", () => {
    expect(resolveHeatmapLevel(1, 1)).toBe(1);
  });

  it("按本地日历日汇总请求，不会把当天请求错位到别的格子", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12, 12, 0, 0));

    const stats = [
      createDailyStat({
        dateKey: "2026-04-12",
      }),
    ];

    const todayKey = toLocalDateKey(new Date(2026, 3, 12, 12, 0, 0));
    const todayEntry = buildHeatmapDays(stats).find((day) => day.dateKey === todayKey);

    expect(todayEntry).toMatchObject({
      level: 1,
      requestCount: 1,
      tokenTotal: 15,
    });
  });

  it("支持按 60 天生成移动端热力图数据", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12, 12, 0, 0));

    const days = buildHeatmapDays([], 60);

    expect(days).toHaveLength(60);
    expect(days[days.length - 1]?.dateKey).toBe("2026-04-12");
  });

  it("移动端热力图按 6 行 10 列分组 60 天数据", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12, 12, 0, 0));

    const columns = buildHeatmapColumns([], {
      dayCount: 60,
      rowCount: 6,
    });

    expect(columns).toHaveLength(10);
    expect(columns.every((column) => column.length === 6)).toBe(true);
  });

  it("按亿、千万、百万语义化展示 token 数", () => {
    expect(formatSemanticTokenCount(2_880_000_000)).toBe("≈ 28.80 亿 tokens");
    expect(formatSemanticTokenCount(28_800_000)).toBe("≈ 2.88 千万 tokens");
    expect(formatSemanticTokenCount(2_880_000)).toBe("≈ 2.88 百万 tokens");
    expect(formatSemanticTokenCount(288_000)).toBe("");
  });
});
