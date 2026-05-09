import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardBook } from "./types";

const { mockFetchFanqieOverallLeaderboard, mockFetchOverallLeaderboard } = vi.hoisted(() => ({
  mockFetchFanqieOverallLeaderboard: vi.fn(),
  mockFetchOverallLeaderboard: vi.fn(),
}));

vi.mock("./leaderboardApi", () => ({
  fetchFanqieOverallLeaderboard: mockFetchFanqieOverallLeaderboard,
  fetchOverallLeaderboard: mockFetchOverallLeaderboard,
  formatCount: (value: number) => String(value),
}));

import { LeaderboardStatsPage } from "./LeaderboardStatsPage";

function createBook(partial: Partial<LeaderboardBook>): LeaderboardBook {
  return {
    abstract: "",
    author: "测试作者",
    bookName: "测试作品",
    category: "都市高武",
    rank: 1,
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
    expect(screen.getByText("需求倍率")).toBeInTheDocument();
    expect(screen.getByText("字数吸量效率")).toBeInTheDocument();
    expect(screen.getByText("腰部承接力")).toBeInTheDocument();
    expect(screen.getByText("长线消化力")).toBeInTheDocument();
    expect(screen.getByLabelText("都市高武 1.13x：1.13x")).toBeInTheDocument();
    expect(screen.getByText("题材机会")).toBeInTheDocument();
    expect(screen.getByText("综合机会题材")).toBeInTheDocument();
    expect(screen.getByText("稳健长线题材")).toBeInTheDocument();
    expect(screen.getByText("爆款样本价值")).toBeInTheDocument();
    expect(screen.getByText("低供给高潜力题材")).toBeInTheDocument();
    expect(screen.getByText(/都市高武 1.2x/)).toBeInTheDocument();
    expect(screen.queryByText("子分类分布明细")).not.toBeInTheDocument();
    expect(screen.queryByText("子分类阅读占比排行")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "综合机会题材说明" }));
    expect(await screen.findByText("计算公式：机会缺口标准化 * 0.35 + 字数吸量效率标准化 * 0.30 + 长线消化力标准化 * 0.20 - 爆款集中度 * 0.15")).toBeInTheDocument();
  });

  it("默认统计今日番茄总榜并支持强制刷新", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([createBook({ readCount: 100 })]);

    renderStatsPage();
    await screen.findByText("入榜作品");
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
