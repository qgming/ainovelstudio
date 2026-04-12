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
          baseURL: "",
          model: "gpt-4.1",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText("Base URL")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://example.com/v1")).toBeInTheDocument();
    expect(screen.getByText("API Key")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    expect(screen.queryByText("Max Tokens")).not.toBeInTheDocument();
  });

  it("缺少必要配置时禁用测试链接按钮", () => {
    render(
      <ModelProviderCard
        config={{
          apiKey: "",
          baseURL: "https://example.com/v1",
          model: "",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "测试链接" })).toBeDisabled();
  });

  it("测试成功时显示成功 toast", async () => {
    mockTestAgentProviderConnection.mockResolvedValue({
      hasContent: true,
      reply: "你好，我已收到测试消息。",
    });

    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={true}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试链接" }));

    expect(mockTestAgentProviderConnection).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "gpt-4.1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("测试成功");
    expect(screen.getByText(/模型连接正常。/)).toBeInTheDocument();
  });

  it("测试失败时显示失败 toast", async () => {
    mockTestAgentProviderConnection.mockRejectedValue(new Error("模型未返回有效内容。"));

    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={true}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试链接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("测试失败：模型未返回有效内容。");
  });

  it("点击保存按钮时触发保存回调", () => {
    const handleSave = vi.fn();

    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={true}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={handleSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(handleSave).toHaveBeenCalledTimes(1);
  });

  it("支持切换 API Key 明文显示", () => {
    render(
      <ModelProviderCard
        config={{
          apiKey: "sk-secret",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    const input = screen.getByDisplayValue("sk-secret");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(input).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "隐藏 API Key" }));
    expect(input).toHaveAttribute("type", "password");
  });
});
