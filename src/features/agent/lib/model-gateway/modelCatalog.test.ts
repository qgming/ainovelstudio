import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProviderModels } from "./modelCatalog";

// fetchProviderModels 直接用 webview 原生 fetch(baseURL+'/models')，不走旧的 Tauri forward 命令，
// 因此 mock 全局 fetch。
const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

function buildResponse(body: string, init: { ok: boolean; status: number }) {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => body,
  } as unknown as Response;
}

describe("modelCatalog", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("调用 /models 并返回去重后的模型列表", async () => {
    mockFetch.mockResolvedValue(
      buildResponse(
        JSON.stringify({
          data: [{ id: "gpt-4.1" }, { id: "gpt-4o" }, { id: "gpt-4.1" }],
        }),
        { ok: true, status: 200 },
      ),
    );

    await expect(
      fetchProviderModels({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "",
        simulateOpencodeBeta: true,
      }),
    ).resolves.toEqual(["gpt-4.1", "gpt-4o"]);

    // 请求目标 URL 与带 Bearer 的鉴权头都应正确拼装。
    // 注意：buildProviderRequestHeaders 经 Headers 规范化，键名会小写。
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.com/v1/models");
    expect((init as RequestInit | undefined)?.headers).toMatchObject({
      authorization: "Bearer sk-test",
      accept: "application/json",
    });
  });

  it("接口 404 时返回明确错误", async () => {
    mockFetch.mockResolvedValue(buildResponse("", { ok: false, status: 404 }));

    await expect(
      fetchProviderModels({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "",
      }),
    ).rejects.toThrow("当前服务未提供 /models 接口。");
  });

  it("响应体非 JSON 时返回友好错误而非原始 SyntaxError", async () => {
    mockFetch.mockResolvedValue(buildResponse("<!DOCTYPE html><html>404</html>", { ok: true, status: 200 }));

    await expect(
      fetchProviderModels({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "",
      }),
    ).rejects.toThrow("解析模型列表响应失败");
  });
});
