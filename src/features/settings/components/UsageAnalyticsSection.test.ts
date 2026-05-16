import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageDailyStat } from "@features/settings/usage/types";
import { buildHeatmapDays, resolveHeatmapLevel, toLocalDateKey } from "./UsageAnalyticsSection";

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
});
