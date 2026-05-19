import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardBook } from "./types";

const { mockEnsureDailyLeaderboardSnapshot, mockFetchFanqieOverallLeaderboard, mockFetchLeaderboard, mockFetchOverallLeaderboard, mockOpenUrl } = vi.hoisted(() => ({
  mockEnsureDailyLeaderboardSnapshot: vi.fn(),
  mockFetchFanqieOverallLeaderboard: vi.fn(),
  mockFetchLeaderboard: vi.fn(),
  mockFetchOverallLeaderboard: vi.fn(),
  mockOpenUrl: vi.fn(),
}));

const { mockReadCachedFanqieOverallLeaderboard, mockReadCachedLeaderboard, mockReadCachedLeaderboardBookDetail, mockReadCachedOverallLeaderboard } = vi.hoisted(() => ({
  mockReadCachedFanqieOverallLeaderboard: vi.fn(),
  mockReadCachedLeaderboard: vi.fn(),
  mockReadCachedLeaderboardBookDetail: vi.fn(),
  mockReadCachedOverallLeaderboard: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

vi.mock("./leaderboardApi", () => ({
  ensureDailyLeaderboardSnapshot: mockEnsureDailyLeaderboardSnapshot,
  fetchFanqieOverallLeaderboard: mockFetchFanqieOverallLeaderboard,
  fetchLeaderboard: mockFetchLeaderboard,
  fetchOverallLeaderboard: mockFetchOverallLeaderboard,
  formatCount: (value: number) => (value >= 10_000 ? `${value / 10_000}万` : String(value)),
  readCachedFanqieOverallLeaderboard: mockReadCachedFanqieOverallLeaderboard,
  readCachedLeaderboard: mockReadCachedLeaderboard,
  readCachedLeaderboardBookDetail: mockReadCachedLeaderboardBookDetail,
  readCachedOverallLeaderboard: mockReadCachedOverallLeaderboard,
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

function createBook(index: number): LeaderboardBook {
  return {
    ...sampleBook,
    bookId: `book-${index}`,
    bookName: `测试作品${index}`,
    detailUrl: `https://fanqienovel.com/page/book-${index}`,
    rank: index,
  };
}

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
    mockEnsureDailyLeaderboardSnapshot.mockReset();
    mockFetchFanqieOverallLeaderboard.mockReset();
    mockFetchLeaderboard.mockReset();
    mockFetchOverallLeaderboard.mockReset();
    mockReadCachedFanqieOverallLeaderboard.mockReset();
    mockReadCachedLeaderboard.mockReset();
    mockReadCachedLeaderboardBookDetail.mockReset();
    mockReadCachedOverallLeaderboard.mockReset();
    mockOpenUrl.mockReset();
    mockEnsureDailyLeaderboardSnapshot.mockResolvedValue(undefined);
    mockReadCachedFanqieOverallLeaderboard.mockReturnValue(null);
    mockReadCachedLeaderboard.mockReturnValue(null);
    mockReadCachedLeaderboardBookDetail.mockReturnValue(null);
    mockReadCachedOverallLeaderboard.mockReturnValue(null);
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
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([sampleBook]);

    renderLeaderboardPage();

    expect(screen.getByText("排行榜")).toBeInTheDocument();
    expect(screen.getByText("男频阅读榜")).toBeInTheDocument();
    expect(await screen.findByText("测试作品")).toBeInTheDocument();
    expect(screen.queryByText("一部适合拆解选题趋势的作品。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("排名无变化")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 测试作品 详情" }));
    expect(await screen.findByText("今日番茄总榜 · 都市高武 · 第 1 名")).toBeInTheDocument();
    expect(await screen.findByText("一部适合拆解选题趋势的作品。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开番茄详情页" }));

    expect(mockOpenUrl).toHaveBeenCalledWith("https://fanqienovel.com/page/book-1");
  });

  it("进入页面时优先使用今日番茄总榜本地缓存", async () => {
    mockReadCachedFanqieOverallLeaderboard.mockReturnValueOnce([sampleBook]);

    renderLeaderboardPage();

    expect(await screen.findByText("测试作品")).toBeInTheDocument();
    expect(mockFetchFanqieOverallLeaderboard).not.toHaveBeenCalled();
  });

  it("总榜图书较多时先渲染首批，滚动到底再追加", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue(
      Array.from({ length: 150 }, (_, index) => createBook(index + 1)),
    );

    renderLeaderboardPage();

    expect(await screen.findByText("测试作品1")).toBeInTheDocument();
    expect(screen.getByText("已显示 120 / 150 本，继续下滑加载更多")).toBeInTheDocument();
    expect(screen.queryByText("测试作品121")).not.toBeInTheDocument();

    const list = screen.getByText("已显示 120 / 150 本，继续下滑加载更多").closest(".overflow-y-auto");
    expect(list).not.toBeNull();
    Object.defineProperties(list!, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 500 },
    });
    fireEvent.scroll(list!);

    expect(await screen.findByText("测试作品121")).toBeInTheDocument();
    expect(screen.queryByText("已显示 120 / 150 本，继续下滑加载更多")).not.toBeInTheDocument();
  });

  it("打开详情时优先使用本地缓存中的完整图书信息", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([{ ...sampleBook, abstract: "列表简介" }]);
    mockReadCachedLeaderboardBookDetail.mockReturnValueOnce({ ...sampleBook, abstract: "本地完整简介" });

    renderLeaderboardPage();
    fireEvent.click(await screen.findByRole("button", { name: "查看 测试作品 详情" }));

    expect(await screen.findByText("本地完整简介")).toBeInTheDocument();
  });

  it("请求失败时显示错误信息", async () => {
    mockEnsureDailyLeaderboardSnapshot.mockRejectedValueOnce(new Error("网络不可达"));

    renderLeaderboardPage();

    expect(await screen.findByText("网络不可达")).toBeInTheDocument();
  });

  it("空结果时显示空状态", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([]);

    renderLeaderboardPage();

    expect(await screen.findByText("暂无榜单数据")).toBeInTheDocument();
  });

  it("切换主榜单后读取本地聚合缓存，不重新请求云端", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([sampleBook]);
    mockReadCachedOverallLeaderboard.mockReturnValue([{ ...sampleBook, bookName: "女频新书缓存" }]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: /女频新书榜/ }));

    expect(await screen.findByText("女频新书缓存")).toBeInTheDocument();
    expect(mockReadCachedOverallLeaderboard).toHaveBeenLastCalledWith({
        categoryId: -1,
        gender: 0,
        type: 1,
      });
    expect(mockFetchOverallLeaderboard).not.toHaveBeenCalled();
    expect(mockFetchLeaderboard).not.toHaveBeenCalled();
  });

  it("切换番茄总榜后隐藏子分类并读取全站总榜", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([{ ...sampleBook, category: "都市脑洞", rank: 14 }]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");

    expect(mockEnsureDailyLeaderboardSnapshot).toHaveBeenCalledWith({ forceRefresh: false });
    expect(screen.queryByRole("button", { name: "都市高武" })).not.toBeInTheDocument();
  });

  it("刷新榜单会强制刷新今日番茄总榜", async () => {
    mockReadCachedFanqieOverallLeaderboard.mockReturnValue([sampleBook]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "刷新榜单" }));

    await waitFor(() => {
      expect(mockEnsureDailyLeaderboardSnapshot).toHaveBeenLastCalledWith({ forceRefresh: true });
    });
  });

  it("切换分类后读取本地分类缓存，不重新请求云端", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([sampleBook]);
    mockReadCachedOverallLeaderboard.mockReturnValue([sampleBook]);
    mockReadCachedLeaderboard.mockReturnValue([{ ...sampleBook, category: "都市高武", bookName: "都市高武缓存" }]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "男频阅读榜" }));
    await screen.findByRole("button", { name: "都市高武" });
    fireEvent.click(screen.getByRole("button", { name: "都市高武" }));

    expect(await screen.findByText("都市高武缓存")).toBeInTheDocument();
    expect(mockReadCachedLeaderboard).toHaveBeenLastCalledWith({
        categoryId: 1014,
        gender: 1,
        type: 2,
      });
    expect(mockFetchLeaderboard).not.toHaveBeenCalled();
  });

  it("总榜显示数据统计入口并进入统计页", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([sampleBook]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "数据统计" }));

    expect(await screen.findByText("统计页路由 ?board=fanqie-overall")).toBeInTheDocument();
  });

  it("切换到单分类后隐藏数据统计入口", async () => {
    mockReadCachedFanqieOverallLeaderboard
      .mockReturnValueOnce(null)
      .mockReturnValue([sampleBook]);
    mockReadCachedOverallLeaderboard.mockReturnValue([sampleBook]);
    mockReadCachedLeaderboard.mockReturnValue([{ ...sampleBook, category: "都市高武" }]);

    renderLeaderboardPage();
    await screen.findByText("测试作品");
    fireEvent.click(screen.getByRole("button", { name: "男频阅读榜" }));
    fireEvent.click(await screen.findByRole("button", { name: "都市高武" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "数据统计" })).not.toBeInTheDocument();
    });
  });
});
