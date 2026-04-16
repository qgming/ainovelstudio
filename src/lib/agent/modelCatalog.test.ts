import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProviderModels } from "./modelCatalog";

const { mockFetchProviderModelsViaTauri } = vi.hoisted(() => ({
  mockFetchProviderModelsViaTauri: vi.fn(),
}));

vi.mock("./providerApi", () => ({
  fetchProviderModelsViaTauri: mockFetchProviderModelsViaTauri,
}));

describe("modelCatalog", () => {
  beforeEach(() => {
    mockFetchProviderModelsViaTauri.mockReset();
  });

  it("调用 /models 并返回去重后的模型列表", async () => {
    mockFetchProviderModelsViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({
        data: [
          { id: "gpt-4.1" },
          { id: "gpt-4o" },
          { id: "gpt-4.1" },
        ],
      }),
    });

    await expect(
      fetchProviderModels({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "",
        simulateOpencodeBeta: true,
      }),
    ).resolves.toEqual(["gpt-4.1", "gpt-4o"]);
    expect(mockFetchProviderModelsViaTauri).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "",
      simulateOpencodeBeta: true,
    });
  });

  it("接口 404 时返回明确错误", async () => {
    mockFetchProviderModelsViaTauri.mockResolvedValue({
      ok: false,
      status: 404,
      body: "",
    });

    await expect(
      fetchProviderModels({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "",
      }),
    ).rejects.toThrow("当前服务未提供 /models 接口。");
  });
});
