import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

function StatsRouteMarker() {
  const location = useLocation();
  return <div>统计页路由 {location.search}</div>;
}

function renderLeaderboardPage() {
  return render(
    <MemoryRouter initialEntries={["/leaderboard"]}>
      <Routes>
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/leaderboard/statistics" element={<StatsRouteMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

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

    renderLeaderboardPage();

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

    renderLeaderboardPage();

    expect(await screen.findByText("网络不可达")).toBeInTheDocument();
  });

  it("空结果时显示空状态", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValueOnce([]);

    renderLeaderboardPage();

    expect(await screen.findByText("暂无榜单数据")).toBeInTheDocument();
  });

  it("切换主榜单后按对应参数刷新总榜", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);
    mockFetchOverallLeaderboard.mockResolvedValue([sampleBook]);

    renderLeaderboardPage();
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

    renderLeaderboardPage();
    await screen.findByText("测试作品");

    await waitFor(() => {
      expect(mockFetchFanqieOverallLeaderboard).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "都市高武" })).not.toBeInTheDocument();
  });

  it("刷新榜单会强制刷新今日番茄总榜", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);

    renderLeaderboardPage();
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

    renderLeaderboardPage();
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

  it("总榜显示数据统计入口并进入统计页", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "数据统计" }));

    expect(await screen.findByText("统计页路由 ?board=fanqie-overall")).toBeInTheDocument();
  });

  it("切换到单分类后隐藏数据统计入口", async () => {
    mockFetchFanqieOverallLeaderboard.mockResolvedValue([sampleBook]);
    mockFetchOverallLeaderboard.mockResolvedValue([sampleBook]);
    mockFetchLeaderboard.mockResolvedValue([{ ...sampleBook, category: "都市高武" }]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "男频阅读榜" }));
    fireEvent.click(await screen.findByRole("button", { name: "都市高武" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "数据统计" })).not.toBeInTheDocument();
    });
  });
});
