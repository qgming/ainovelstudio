import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageLogEntry } from "../../lib/usage/types";
import { buildHeatmapDays, resolveHeatmapLevel, toLocalDateKey } from "./UsageAnalyticsSection";

function createLog(overrides: Partial<UsageLogEntry> = {}): UsageLogEntry {
  return {
    bookName: "测试书籍",
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    createdAt: "0",
    finishReason: "stop",
    inputTokens: 10,
    messageId: "message-1",
    modelId: "test-model",
    noCacheTokens: 0,
    outputTokens: 5,
    provider: "test-provider",
    reasoningTokens: 0,
    recordedAt: "0",
    sessionId: "session-1",
    sessionTitle: "测试会话",
    totalTokens: 15,
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

    const logs = [
      createLog({
        messageId: "message-2",
        recordedAt: Math.floor(new Date(2026, 3, 12, 0, 30, 0).getTime() / 1000).toString(),
      }),
    ];

    const todayKey = toLocalDateKey(new Date(2026, 3, 12, 12, 0, 0));
    const todayEntry = buildHeatmapDays(logs).find((day) => day.dateKey === todayKey);

    expect(todayEntry).toMatchObject({
      level: 1,
      requestCount: 1,
      tokenTotal: 15,
    });
  });
});
