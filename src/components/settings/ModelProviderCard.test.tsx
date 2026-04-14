import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTestAgentProviderConnection } = vi.hoisted(() => ({
  mockTestAgentProviderConnection: vi.fn(),
}));

vi.mock("../../lib/agent/modelGateway", () => ({
  testAgentProviderConnection: mockTestAgentProviderConnection,
}));

vi.mock("@lobehub/icons", () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`provider-icon-${provider}`} />,
  Claude: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-claude" />,
  },
  Gemini: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-gemini" />,
  },
  Qwen: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-qwen" />,
  },
  Zhipu: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-zhipu" />,
  },
  XiaomiMiMo: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-xiaomi-mimo" />,
  SiliconCloud: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-siliconflow" />,
  },
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

  it("缺少必要配置时禁用测试连接按钮", () => {
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

    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
  });

  it("测试成功时仅显示简短成功提示", async () => {
    mockTestAgentProviderConnection.mockResolvedValue({
      ok: true,
      status: "success",
      stage: "response",
      message: "已连接到模型并收到有效响应。",
      provider: {
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      },
      diagnostics: {
        durationMs: 842,
        responseTextPreview: "你好，我已收到测试消息。",
      },
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

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(mockTestAgentProviderConnection).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "gpt-4.1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("测试成功");
    expect(screen.getByRole("status")).toHaveTextContent("连接成功");
    expect(screen.queryByText(/已连接到模型并收到有效响应。/)).not.toBeInTheDocument();
    expect(screen.queryByText(/响应：你好，我已收到测试消息。/)).not.toBeInTheDocument();
    expect(screen.queryByText(/耗时：842ms/)).not.toBeInTheDocument();
  });

  it("鉴权失败时显示明确提示", async () => {
    mockTestAgentProviderConnection.mockResolvedValue({
      ok: false,
      status: "auth_error",
      stage: "request",
      message: "鉴权失败，请检查 API Key 是否有效或是否具备调用权限。",
      provider: {
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      },
      diagnostics: {
        httpStatus: 401,
      },
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

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("鉴权失败");
    expect(screen.getByText(/鉴权失败，请检查 API Key 是否有效或是否具备调用权限。/)).toBeInTheDocument();
  });

  it("响应无效时显示明确提示", async () => {
    mockTestAgentProviderConnection.mockResolvedValue({
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型未直接返回文本，而是返回了工具调用。",
      provider: {
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      },
      diagnostics: {
        finishReason: "tool-calls",
      },
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

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("响应无效");
    expect(screen.getByText(/模型未直接返回文本，而是返回了工具调用。/)).toBeInTheDocument();
  });

  it("测试中显示加载态", async () => {
    mockTestAgentProviderConnection.mockResolvedValue({
      ok: true,
      status: "success",
      stage: "response",
      message: "已连接到模型并收到有效响应。",
      provider: {
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      },
      diagnostics: {
        durationMs: 120,
      },
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

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByRole("status")).toHaveTextContent("测试成功");
    expect(screen.getByRole("status")).toHaveTextContent("连接成功");
  });

  it("显示推荐供应商卡片与详情链接", () => {
    render(
      <ModelProviderCard
        config={{
          apiKey: "",
          baseURL: "",
          model: "",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("智谱 AI")).toBeInTheDocument();
    expect(screen.getByText("小米 MiMo")).toBeInTheDocument();
    expect(screen.getByText("硅基流动")).toBeInTheDocument();
    expect(screen.getByText("Moonshot AI")).toBeInTheDocument();
    expect(screen.getByText("LongCat")).toBeInTheDocument();
    expect(screen.getByText("ByteDance")).toBeInTheDocument();
    expect(screen.getByText("Qwen")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-openai")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-claude")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-gemini")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-zhipu")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-xiaomi-mimo")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-siliconflow")).toBeInTheDocument();
    expect(screen.getByTestId("provider-icon-qwen")).toBeInTheDocument();

    const detailButtons = screen.getAllByRole("button", { name: /查看 .* 详情/ });
    expect(detailButtons).toHaveLength(14);
  });

  it("点击推荐供应商卡片时回填 Base URL", () => {
    const handleChange = vi.fn();

    render(
      <ModelProviderCard
        config={{
          apiKey: "",
          baseURL: "",
          model: "",
        }}
        isDirty={false}
        onChange={handleChange}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "使用 OpenAI 地址" }));

    expect(handleChange).toHaveBeenCalledWith({ baseURL: "https://api.openai.com/v1" });
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
