import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardBook } from "./types";

const { mockFetchFanqieOverallLeaderboard, mockFetchLeaderboard, mockFetchOverallLeaderboard, mockOpenUrl } = vi.hoisted(() => ({
  mockFetchFanqieOverallLeaderboard: vi.fn(),
  mockFetchLeaderboard: vi.fn(),
  mockFetchOverallLeaderboard: vi.fn(),
  mockOpenUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

vi.mock("./leaderboardApi", () => ({
  fetchFanqieOverallLeaderboard: mockFetchFanqieOverallLeaderboard,
  fetchLeaderboard: mockFetchLeaderboard,
  fetchOverallLeaderboard: mockFetchOverallLeaderboard,
  formatCount: (value: number) => (value >= 10_000 ? `${value / 10_000}万` : String(value)),
}));

import { LeaderboardPage } from "./LeaderboardPage";

const sampleBook: LeaderboardBook = {
  abstract: "一部适合拆解选题趋势的作品。",
  author: "测试作者",
  bookId: "book-1",
  bookName: "测试作品",
  category: "都市高武",
  detailUrl: "https://fanqienovel.com/page/book-1",
  rank: 1,
  readCount: 120_000,
  status: "连载中",
  thumbUri: "",
  wordCount: 300_000,
};

describe("LeaderboardPage", () => {
  beforeEach(() => {
    mockFetchFanqieOverallLeaderboard.mockReset();
    mockFetchLeaderboard.mockReset();
    mockFetchOverallLeaderboard.mockReset();
    mockOpenUrl.mockReset();
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("显示加载态后渲染卡片，点击后用弹窗展示详情并可打开外链", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValueOnce([sampleBook]);

    render(<LeaderboardPage />);

    expect(screen.getByText("排行榜")).toBeInTheDocument();
    expect(screen.getByText("男频阅读榜")).toBeInTheDocument();
    expect(await screen.findByText("测试作品")).toBeInTheDocument();
    expect(screen.queryByText("一部适合拆解选题趋势的作品。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 测试作品 详情" }));
    expect(await screen.findByText("今日番茄总榜 · 都市高武 · 第 1 名")).toBeInTheDocument();
    expect(await screen.findByText("一部适合拆解选题趋势的作品。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开番茄详情页" }));

    expect(mockOpenUrl).toHaveBeenCalledWith("https://fanqienovel.com/page/book-1");
  });

  it("请求失败时显示错误信息", async () => {
    mockFetchFanqieOverallLeaderboard.mockRejectedValueOnce(new Error("网络不可达"));

    render(<LeaderboardPage />);

    expect(await screen.findByText("网络不可达")).toBeInTheDocument();
  });

  it("空结果时显示空状态", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValueOnce([]);

    render(<LeaderboardPage />);

    expect(await screen.findByText("暂无榜单数据")).toBeInTheDocument();
  });

  it("切换主榜单后按对应参数刷新总榜", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);
    mockFetchOverallLeaderboard.mockResolvedValue([sampleBook]);

    render(<LeaderboardPage />);
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: /女频新书榜/ }));

    await waitFor(() => {
      expect(mockFetchOverallLeaderboard).toHaveBeenLastCalledWith({
        categoryId: -1,
        gender: 0,
        type: 1,
      });
    });
  });

  it("切换番茄总榜后隐藏子分类并读取全站总榜", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([{ ...sampleBook, category: "都市脑洞", rank: 14 }]);

    render(<LeaderboardPage />);
    await screen.findByText("测试作品");

    await waitFor(() => {
      expect(mockFetchFanqieOverallLeaderboard).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "都市高武" })).not.toBeInTheDocument();
  });

  it("刷新榜单会强制刷新今日番茄总榜", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);

    render(<LeaderboardPage />);
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "刷新榜单" }));

    await waitFor(() => {
      expect(mockFetchFanqieOverallLeaderboard).toHaveBeenLastCalledWith(undefined, { forceRefresh: true });
    });
  });

  it("切换分类后请求单分类榜", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);
    mockFetchOverallLeaderboard.mockResolvedValue([sampleBook]);
    mockFetchLeaderboard.mockResolvedValue([{ ...sampleBook, category: "都市高武" }]);

    render(<LeaderboardPage />);
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "男频阅读榜" }));
    await screen.findByRole("button", { name: "都市高武" });
    fireEvent.click(screen.getByRole("button", { name: "都市高武" }));

    await waitFor(() => {
      expect(mockFetchLeaderboard).toHaveBeenCalledWith({
        categoryId: 1014,
        gender: 1,
        type: 2,
      });
    });
  });
});
