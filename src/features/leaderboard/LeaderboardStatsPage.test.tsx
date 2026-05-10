import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardBook } from "./types";

const { mockFetchFanqieOverallLeaderboard, mockFetchOverallLeaderboard } = vi.hoisted(() => ({
  mockFetchFanqieOverallLeaderboard: vi.fn(),
  mockFetchOverallLeaderboard: vi.fn(),
}));

const { mockReadCachedFanqieOverallLeaderboard, mockReadCachedOverallLeaderboard } = vi.hoisted(() => ({
  mockReadCachedFanqieOverallLeaderboard: vi.fn(),
  mockReadCachedOverallLeaderboard: vi.fn(),
}));

vi.mock("./leaderboardApi", () => ({
  fetchFanqieOverallLeaderboard: mockFetchFanqieOverallLeaderboard,
  fetchOverallLeaderboard: mockFetchOverallLeaderboard,
  formatCount: (value: number) => String(value),
  readCachedFanqieOverallLeaderboard: mockReadCachedFanqieOverallLeaderboard,
  readCachedOverallLeaderboard: mockReadCachedOverallLeaderboard,
}));

import { LeaderboardStatsPage } from "./LeaderboardStatsPage";

function createBook(partial: Partial<LeaderboardBook>): LeaderboardBook {
  const rank = partial.rank ?? 1;
  return {
    abstract: "",
    author: "测试作者",
    bookName: "测试作品",
    category: "都市高武",
    categoryRank: partial.categoryRank ?? rank,
    rank,
    readCount: 0,
    status: "连载中",
    wordCount: 100_000,
    ...partial,
  };
}

function renderStatsPage(initialEntry = "/leaderboard/statistics") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/leaderboard/statistics" element={<LeaderboardStatsPage />} />
        <Route path="/leaderboard" element={<div>排行榜路由</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LeaderboardStatsPage", () => {
  beforeEach(() => {
    mockFetchFanqieOverallLeaderboard.mockReset();
    mockFetchOverallLeaderboard.mockReset();
    mockReadCachedFanqieOverallLeaderboard.mockReset();
    mockReadCachedOverallLeaderboard.mockReset();
    mockReadCachedFanqieOverallLeaderboard.mockReturnValue(null);
    mockReadCachedOverallLeaderboard.mockReturnValue(null);
  });

  it("通过标题面包屑返回排行榜", async () => {
    mockFetchOverallLeaderboard.mockResolvedValue([createBook({ readCount: 100 })]);

    renderStatsPage("/leaderboard/statistics?board=male-reading");

    expect(await screen.findByText("数据统计")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "排行榜" }));
    expect(await screen.findByText("排行榜路由")).toBeInTheDocument();
  });

  it("按主榜总榜统计子分类作品占比和阅读占比", async () => {
    mockFetchOverallLeaderboard.mockResolvedValue([
      createBook({ bookName: "都市作品一", category: "都市高武", readCount: 100 }),
      createBook({ bookName: "都市作品二", category: "都市高武", readCount: 50, rank: 2 }),
      createBook({ bookName: "玄幻作品", category: "传统玄幻", readCount: 50, rank: 3, status: "已完结" }),
    ]);

    renderStatsPage("/leaderboard/statistics?board=male-reading");

    expect(await screen.findByText("数据统计")).toBeInTheDocument();
    expect(mockFetchOverallLeaderboard).toHaveBeenCalledWith({ categoryId: -1, gender: 1, type: 2 });
    expect(screen.getAllByText("都市高武").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "子分类数量占比饼状图" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "子分类在读占比饼状图" })).toBeInTheDocument();
    expect(screen.queryByText("其他分类")).not.toBeInTheDocument();
    expect(screen.queryByText("兴趣信号")).not.toBeInTheDocument();
    expect(screen.getByText("题材机会榜")).toBeInTheDocument();
    expect(screen.getAllByText("机会判断").length).toBeGreaterThan(0);
    expect(screen.getAllByText("热度变化").length).toBeGreaterThan(0);
    expect(screen.getAllByText("承接结构").length).toBeGreaterThan(0);
    expect(screen.getAllByText("竞争风险").length).toBeGreaterThan(0);
    expect(screen.getAllByText("写作空间").length).toBeGreaterThan(0);
    expect(screen.getByText("代表作")).toBeInTheDocument();
    expect(screen.getAllByText("综合机会题材").length).toBeGreaterThan(0);
    expect(screen.getAllByText("新手友好题材").length).toBeGreaterThan(0);
    expect(screen.getAllByText("短期热度题材").length).toBeGreaterThan(0);
    expect(screen.getAllByText("稳健长篇题材").length).toBeGreaterThan(0);
    expect(screen.getByText("拆书样本题材")).toBeInTheDocument();
    expect(screen.getAllByText("风险预警题材").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/都市高武/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("《都市作品一》").length).toBeGreaterThan(0);
    expect(screen.queryByText("子分类分布明细")).not.toBeInTheDocument();
    expect(screen.queryByText("子分类阅读占比排行")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新手友好题材说明" }));
    expect(await screen.findByText("怎么用")).toBeInTheDocument();
    expect(await screen.findByText("计算公式：0.22 * 中段阅读占比 + 0.20 * 中段上升率 + 0.18 * 字数吸量 + 0.16 * 前30吸量 + 0.14 * 趋势动能 + 0.10 * 读者份额 - 0.18 * Top1集中度 - 0.10 * Top3集中度")).toBeInTheDocument();
    expect(screen.queryByText("新作家怎么看")).not.toBeInTheDocument();
    expect(screen.queryByText("老作家怎么看")).not.toBeInTheDocument();
  });

  it("默认统计今日番茄总榜并支持强制刷新", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([createBook({ readCount: 100 })]);

    renderStatsPage();
    await screen.findAllByText("新手友好题材");
    fireEvent.click(screen.getByRole("button", { name: "刷新统计" }));

    await waitFor(() => {
      expect(mockFetchFanqieOverallLeaderboard).toHaveBeenLastCalledWith(undefined, { forceRefresh: true });
    });
  });

  it("支持移除前90部和后90部后重新统计", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => createBook({
        bookName: `作品${index + 1}`,
        category: index < 90 ? "头部题材" : "尾部题材",
        rank: index + 1,
        readCount: 1000 - index,
      })),
    );

    renderStatsPage();

    expect(await screen.findByText("当前统计 100 / 100 本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除前90部" }));
    expect(screen.getByText("当前统计 10 / 100 本")).toBeInTheDocument();
    expect(screen.getAllByText("尾部题材").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "移除后90部" }));
    expect(screen.getByText("当前统计 10 / 100 本")).toBeInTheDocument();
    expect(screen.getAllByText("头部题材").length).toBeGreaterThan(0);
  });

  it("支持移除前一半和后一半后重新统计", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => createBook({
        bookName: `作品${index + 1}`,
        category: index < 4 ? "前半题材" : "后半题材",
        rank: index + 1,
        readCount: 1000 - index,
      })),
    );

    renderStatsPage();

    expect(await screen.findByText("当前统计 9 / 9 本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除前一半" }));
    expect(screen.getByText("当前统计 4 / 9 本")).toBeInTheDocument();
    expect(screen.getAllByText("后半题材").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "移除后一半" }));
    expect(screen.getByText("当前统计 4 / 9 本")).toBeInTheDocument();
    expect(screen.getAllByText("前半题材").length).toBeGreaterThan(0);
  });
});
