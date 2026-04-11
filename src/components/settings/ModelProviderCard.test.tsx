import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTestAgentProviderConnection } = vi.hoisted(() => ({
  mockTestAgentProviderConnection: vi.fn(),
}));

vi.mock("../../lib/agent/modelGateway", () => ({
  testAgentProviderConnection: mockTestAgentProviderConnection,
}));

import { ModelProviderCard } from "./ModelProviderCard";

describe("ModelProviderCard", () => {
  beforeEach(() => {
    mockTestAgentProviderConnection.mockReset();
  });

  it("隐藏温度和最大 token 配置，仅保留核心字段", () => {
    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-test",
          baseURL: "https://api.openai.com/v1",
          maxOutputTokens: 4096,
          model: "gpt-4.1",
          temperature: 0.7,
        }}
        onChange={() => undefined}
        onReset={() => undefined}
      />,
    );

    expect(screen.getByText("Base URL")).toBeInTheDocument();
    expect(screen.getByText("API Key")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    expect(screen.queryByText("Max Tokens")).not.toBeInTheDocument();
  });

  it("缺少必要配置时禁用测试链接按钮", () => {
    render(
      <ModelProviderCard
        config={{
          apiKey: "",
          baseURL: "https://example.com/v1",
          maxOutputTokens: 4096,
          model: "",
          temperature: 0.7,
        }}
        onChange={() => undefined}
        onReset={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "测试链接" })).toBeDisabled();
  });

  it("测试成功时显示成功 toast", async () => {
    mockTestAgentProviderConnection.mockResolvedValue({
      expectedReply: "CONNECTION_OK",
      reply: "CONNECTION_OK",
    });

    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          maxOutputTokens: 4096,
          model: "gpt-4.1",
          temperature: 0.7,
        }}
        onChange={() => undefined}
        onReset={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试链接" }));

    expect(mockTestAgentProviderConnection).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      maxOutputTokens: 4096,
      model: "gpt-4.1",
      temperature: 0.7,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("测试成功");
    expect(screen.getByText(/CONNECTION_OK/)).toBeInTheDocument();
  });

  it("测试失败时显示失败 toast", async () => {
    mockTestAgentProviderConnection.mockRejectedValue(new Error("模型返回校验失败：你好"));

    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          maxOutputTokens: 4096,
          model: "gpt-4.1",
          temperature: 0.7,
        }}
        onChange={() => undefined}
        onReset={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试链接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("测试失败：模型返回校验失败：你好");
  });
});
