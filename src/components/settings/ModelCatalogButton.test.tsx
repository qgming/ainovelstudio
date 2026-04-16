import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchProviderModels } = vi.hoisted(() => ({
  mockFetchProviderModels: vi.fn(),
}));

vi.mock("../../lib/agent/modelCatalog", () => ({
  fetchProviderModels: mockFetchProviderModels,
}));

import { ModelCatalogButton } from "./ModelCatalogButton";

describe("ModelCatalogButton", () => {
  beforeEach(() => {
    mockFetchProviderModels.mockReset();
  });

  it("缺少必要配置时禁用获取模型按钮", () => {
    render(
      <ModelCatalogButton
        config={{
          apiKey: "",
          baseURL: "https://example.com/v1",
          model: "",
        }}
        onSelectModel={() => undefined}
        onError={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "获取模型" })).toBeDisabled();
  });

  it("获取成功后可以使用默认模型", async () => {
    const handleSelectModel = vi.fn();
    mockFetchProviderModels.mockResolvedValue(["gpt-4.1", "gpt-4o"]);

    render(
      <ModelCatalogButton
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "",
        }}
        onSelectModel={handleSelectModel}
        onError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));

    expect(await screen.findByText("选择模型")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用模型" }));

    expect(handleSelectModel).toHaveBeenCalledWith("gpt-4.1");
  });

  it("支持直接点击列表项切换模型", async () => {
    const handleSelectModel = vi.fn();
    mockFetchProviderModels.mockResolvedValue(["gpt-4.1", "gpt-4o"]);

    render(
      <ModelCatalogButton
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "",
        }}
        onSelectModel={handleSelectModel}
        onError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));

    expect(await screen.findByText("选择模型")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "gpt-4o" }));
    fireEvent.click(screen.getByRole("button", { name: "使用模型" }));

    expect(handleSelectModel).toHaveBeenCalledWith("gpt-4o");
  });

  it("获取失败时回调错误信息", async () => {
    const handleError = vi.fn();
    mockFetchProviderModels.mockRejectedValue(new Error("获取失败"));

    render(
      <ModelCatalogButton
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "",
        }}
        onSelectModel={() => undefined}
        onError={handleError}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));

    await screen.findByRole("button", { name: "获取模型" });
    expect(handleError).toHaveBeenCalledWith("获取失败");
  });
});
