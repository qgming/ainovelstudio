import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFanqieOverallLeaderboard,
  fetchLeaderboard,
  fetchOverallLeaderboard,
  parseLeaderboardBooks,
  parseReadableCount,
} from "./leaderboardApi";

const { mockForward } = vi.hoisted(() => ({
  mockForward: vi.fn(),
}));

vi.mock("@features/agent/lib/providerApi", () => ({
  forwardProviderRequestViaTauri: mockForward,
}));

function createRankHtml(bookList: unknown[]) {
  return `<script>window.__INITIAL_STATE__=${JSON.stringify({ rank: { book_list: bookList } })};</script>`;
}

function createRankApiJson(bookList: unknown[]) {
  return JSON.stringify({ code: 0, data: { book_list: bookList } });
}

function createBook(patch: Record<string, unknown>) {
  return {
    abstract: "简介",
    author: "作者",
    bookId: "book-1",
    bookName: "作品",
    creationStatus: "1",
    currentPos: 1,
    read_count: "1,234",
    wordNumber: "300000",
    ...patch,
  };
}

describe("leaderboardApi", () => {
  beforeEach(() => {
    mockForward.mockReset();
    localStorage.clear();
  });

  it("解析在读数量格式", () => {
    expect(parseReadableCount("577.7万")).toBe(5_777_000);
    expect(parseReadableCount("1,234")).toBe(1_234);
    expect(parseReadableCount("")).toBe(0);
  });

  it("从初始状态解析并解码书籍", () => {
    const html = createRankHtml([
      createBook({
        author: String.fromCharCode(58657),
        bookName: String.fromCharCode(58475),
      }),
    ]);

    expect(parseLeaderboardBooks(html)[0]).toMatchObject({
      author: "我",
      bookName: "书",
      detailUrl: "https://fanqienovel.com/page/book-1",
      rankPosDiff: 0,
      readCount: 1234,
      status: "连载中",
    });
  });

  it("解析接口返回的排行变化", () => {
    const html = createRankHtml([createBook({ rankPosDiff: -2 })]);

    expect(parseLeaderboardBooks(html)[0]).toMatchObject({
      rank: 1,
      rankPosDiff: -2,
    });
  });

  it("请求单分类榜并处理 HTTP 错误", async () => {
    mockForward
      .mockResolvedValueOnce({ ok: false, status: 500, body: "" })
      .mockResolvedValueOnce({ ok: false, status: 500, body: "" })
      .mockResolvedValueOnce({ ok: false, status: 500, body: "" });

    await expect(fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 })).rejects.toThrow("HTTP 500");
  });

  it("请求单分类榜并在解析为空时报错", async () => {
    mockForward.mockResolvedValueOnce({ ok: true, status: 200, body: createRankApiJson([]) });

    await expect(fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 })).rejects.toThrow("解析为空");
  });

  it("遇到 444 会退避重试榜单接口", async () => {
    mockForward
      .mockResolvedValueOnce({ ok: false, status: 444, body: "" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createRankApiJson([createBook({ bookId: "retry-book" })]),
      });

    const books = await fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 });

    expect(books[0]).toMatchObject({ bookId: "retry-book" });
    expect(mockForward).toHaveBeenCalledTimes(2);
  });

  it("444 重试耗尽后不会继续请求 HTML 兜底", async () => {
    mockForward
      .mockResolvedValueOnce({ ok: false, status: 444, body: "" })
      .mockResolvedValueOnce({ ok: false, status: 444, body: "" })
      .mockResolvedValueOnce({ ok: false, status: 444, body: "" });

    await expect(fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 })).rejects.toThrow("HTTP 444");
    expect(mockForward).toHaveBeenCalledTimes(3);
  });

  it("请求单分类榜默认通过 JSON 接口获取 30 本", async () => {
    mockForward.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createRankApiJson(
        Array.from({ length: 35 }, (_, index) => createBook({
          bookId: `book-${index + 1}`,
          bookName: `作品${index + 1}`,
          currentPos: index + 1,
        })),
      ),
    });

    const books = await fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 });

    expect(books).toHaveLength(30);
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("/api/rank/category/list?"),
    }));
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("limit=30"),
    }));
  });

  it("总榜合并分类、去重、排序并截断", async () => {
    mockForward.mockImplementation(({ url }: { url: string }) => {
      const categoryId = Number(new URL(url).searchParams.get("category_id"));
      const isFirstCategory = categoryId === 1014;
      const isSecondCategory = categoryId === 8;
      const book = isFirstCategory
        ? createBook({ bookId: "dup", bookName: "重复作品", read_count: "20" })
        : isSecondCategory
          ? createBook({ bookId: "dup", bookName: "重复作品", read_count: "30" })
          : createBook({ bookId: `book-${categoryId}`, bookName: `作品${categoryId}`, read_count: "1" });
      return Promise.resolve({ ok: true, status: 200, body: createRankApiJson([book]) });
    });

    const books = await fetchOverallLeaderboard({ categoryId: -1, gender: 1, limit: 2, type: 2 });

    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({ bookId: "dup", rank: 1, readCount: 30 });
    expect(books[1].readCount).toBe(1);
  });

  it("总榜默认返回所有子分类合并去重后的作品", async () => {
    mockForward.mockImplementation(({ url }: { url: string }) => {
      const categoryId = Number(new URL(url).searchParams.get("category_id"));
      return Promise.resolve({
        ok: true,
        status: 200,
        body: createRankApiJson(
          Array.from({ length: 30 }, (_, index) => createBook({
            bookId: `book-${categoryId}-${index + 1}`,
            bookName: `作品${categoryId}-${index + 1}`,
            currentPos: index + 1,
            read_count: String(10_000 - categoryId - index),
          })),
        ),
      });
    });

    const books = await fetchOverallLeaderboard({ categoryId: -1, gender: 1, type: 2 });

    expect(books).toHaveLength(570);
    expect(books[0].rank).toBe(1);
    expect(books[569].rank).toBe(570);
  });

  it("番茄总榜默认合并四个主榜的所有子分类作品", async () => {
    mockForward.mockImplementation(({ url }: { url: string }) => {
      const params = new URL(url).searchParams;
      const categoryId = Number(params.get("category_id"));
      const gender = params.get("gender");
      const type = params.get("rankMold");
      return Promise.resolve({
        ok: true,
        status: 200,
        body: createRankApiJson(
          Array.from({ length: 30 }, (_, index) => createBook({
            bookId: `book-${gender}-${type}-${categoryId}-${index + 1}`,
            bookName: `作品${gender}-${type}-${categoryId}-${index + 1}`,
            currentPos: index + 1,
            read_count: String(20_000 - categoryId - index),
          })),
        ),
      });
    });

    const books = await fetchFanqieOverallLeaderboard();

    expect(books).toHaveLength(2220);
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("gender=1"),
    }));
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("gender=0"),
    }));
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("rankMold=2"),
    }));
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining("rankMold=1"),
    }));
  });

  it("番茄总榜支持显式限制合并后的数量", async () => {
    mockForward.mockImplementation(({ url }: { url: string }) => {
      const params = new URL(url).searchParams;
      const categoryId = Number(params.get("category_id"));
      const gender = params.get("gender");
      const type = params.get("rankMold");
      return Promise.resolve({
        ok: true,
        status: 200,
        body: createRankApiJson(
          Array.from({ length: 30 }, (_, index) => createBook({
            bookId: `book-${gender}-${type}-${categoryId}-${index + 1}`,
            bookName: `作品${gender}-${type}-${categoryId}-${index + 1}`,
            currentPos: index + 1,
            read_count: String(20_000 - categoryId - index),
          })),
        ),
      });
    });

    const books = await fetchFanqieOverallLeaderboard(180);

    expect(books).toHaveLength(180);
    expect(books[179].rank).toBe(180);
  });

  it("当天缓存命中时复用本地榜单，强制刷新时重新请求", async () => {
    mockForward.mockResolvedValue({
      ok: true,
      status: 200,
      body: createRankApiJson(
        Array.from({ length: 30 }, (_, index) => createBook({
          bookId: `cached-book-${index + 1}`,
          bookName: `缓存作品${index + 1}`,
          currentPos: index + 1,
        })),
      ),
    });

    await fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 });
    await fetchLeaderboard({ categoryId: 1014, gender: 1, type: 2 });
    await fetchLeaderboard({ categoryId: 1014, forceRefresh: true, gender: 1, type: 2 });

    expect(mockForward).toHaveBeenCalledTimes(2);
  });

  it("今日番茄总榜当天复用聚合缓存，强制刷新时更新缓存", async () => {
    mockForward.mockImplementation(({ url }: { url: string }) => {
      const params = new URL(url).searchParams;
      const categoryId = Number(params.get("category_id"));
      const gender = params.get("gender");
      const type = params.get("rankMold");
      return Promise.resolve({
        ok: true,
        status: 200,
        body: createRankApiJson([
          createBook({
            bookId: `merged-${gender}-${type}-${categoryId}`,
            bookName: `聚合作品${gender}-${type}-${categoryId}`,
            read_count: String(20_000 - categoryId),
          }),
        ]),
      });
    });

    const firstBooks = await fetchFanqieOverallLeaderboard();
    const firstRequestCount = mockForward.mock.calls.length;
    const secondBooks = await fetchFanqieOverallLeaderboard();
    const secondRequestCount = mockForward.mock.calls.length;
    await fetchFanqieOverallLeaderboard(undefined, { forceRefresh: true });

    expect(firstBooks.length).toBeGreaterThan(0);
    expect(secondBooks).toEqual(firstBooks);
    expect(secondRequestCount).toBe(firstRequestCount);
    expect(mockForward.mock.calls.length).toBeGreaterThan(secondRequestCount);
  });
});
