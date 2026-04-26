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

function mockViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" ? width < 768 : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("ModelProviderCard", () => {
  beforeEach(() => {
    mockTestAgentProviderConnection.mockReset();
    mockViewport(1280);
  });

  it("隐藏温度和最大 token 配置，仅保留核心字段", () => {
    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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
    expect(screen.getByText("思考模式 reasoning_effort")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    expect(screen.queryByText("Max Tokens")).not.toBeInTheDocument();
  });

  it("思考强度默认选中 xhigh", () => {
    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: /xhigh/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("缺少必要配置时禁用测试连接按钮", () => {
    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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

    expect(screen.getByTestId("model-provider-recommendations")).toHaveClass("grid-cols-[repeat(auto-fill,minmax(180px,1fr))]");
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

  it("显示预存供应商标题，且卡片背景与推荐供应商区域一致", () => {
    render(
      <ModelProviderCard
        providerPresets={[
          {
            id: "preset-1",
            name: "OpenAI",
            apiKey: "sk-openai",
            model: "gpt-4.1",
            provider: "openai",
            baseURL: "https://api.openai.com/v1",
            createdAt: "2026-04-23T00:00:00.000Z",
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        ]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "",
          baseURL: "https://api.openai.com/v1",
          model: "",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText("预存供应商")).toBeInTheDocument();

    const presetCard = screen.getByText("gpt-4.1").closest("article");
    expect(presetCard).toHaveClass("editor-block-tile", "aspect-square");
    expect(presetCard).not.toHaveClass("bg-background");
    const presetButton = presetCard?.querySelector('[role="button"][aria-label="使用 OpenAI 地址"]');
    expect(presetButton).not.toHaveClass("bg-accent/35");
  });

  it("点击推荐供应商卡片时只回填 Base URL", () => {
    const handleChange = vi.fn();
    const handleAddProviderPreset = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={handleAddProviderPreset}
        onDeleteProviderPreset={() => undefined}
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
    expect(handleAddProviderPreset).not.toHaveBeenCalled();
  });

  it("预存配置需要完整填写 url、key 和 model", async () => {
    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "",
          baseURL: "https://api.openai.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预存配置" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败：需要完整填写 Base URL、API Key 和 Model");
  });

  it("点击预存配置时保存 url、key 和 model", () => {
    const handleAddProviderPreset = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={handleAddProviderPreset}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "sk-openai",
          baseURL: "https://api.openai.com/v1",
          model: "gpt-4.1",
        }}
        isDirty={false}
        onChange={() => undefined}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预存配置" }));

    expect(handleAddProviderPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-openai",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-4.1",
      }),
    );
  });

  it("点击预存供应商时回填 url、key 和 model", () => {
    const handleChange = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[
          {
            id: "preset-1",
            name: "OpenAI",
            apiKey: "sk-openai",
            model: "gpt-4.1",
            provider: "openai",
            baseURL: "https://api.openai.com/v1",
            createdAt: "2026-04-23T00:00:00.000Z",
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        ]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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

    fireEvent.click(screen.getAllByRole("button", { name: "使用 OpenAI 地址" })[0]);

    expect(handleChange).toHaveBeenCalledWith({
      apiKey: "sk-openai",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1",
    });
  });

  it("点击保存按钮时触发保存回调", () => {
    const handleSave = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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

  it("移动端顶部按钮切换为纯图标但保留可访问名称", () => {
    mockViewport(390);

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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

    expect(screen.getByRole("button", { name: "获取模型" })).not.toHaveTextContent("获取模型");
    expect(screen.getByRole("button", { name: "保存" })).not.toHaveTextContent("保存");
    expect(screen.getByRole("button", { name: "测试连接" })).not.toHaveTextContent("测试连接");
    expect(screen.getByRole("button", { name: "重置" })).not.toHaveTextContent("重置");
  });

  it("支持切换 API Key 明文显示", () => {
    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
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

  it("支持切换模拟 OpenCode（beta）开关", () => {
    const handleChange = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "sk-secret",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
          simulateOpencodeBeta: false,
        }}
        isDirty={false}
        onChange={handleChange}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "切换模拟 OpenCode（beta）" }));

    expect(screen.getByText("模拟 OpenCode（beta）")).toBeInTheDocument();
    expect(handleChange).toHaveBeenCalledWith({ simulateOpencodeBeta: true });
  });

  it("支持切换思考模式开关", () => {
    const handleChange = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "sk-secret",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
          enableReasoningEffort: false,
          reasoningEffort: "xhigh",
        }}
        isDirty={false}
        onChange={handleChange}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "切换思考模式 reasoning_effort" }));

    expect(handleChange).toHaveBeenCalledWith({ enableReasoningEffort: true });
  });

  it("支持切换 reasoning_effort 强度", () => {
    const handleChange = vi.fn();

    render(
      <ModelProviderCard
        providerPresets={[]}
        onAddProviderPreset={() => undefined}
        onDeleteProviderPreset={() => undefined}
        config={{
          apiKey: "sk-secret",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
          enableReasoningEffort: true,
          reasoningEffort: "xhigh",
        }}
        isDirty={false}
        onChange={handleChange}
        onReset={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /medium/i }));

    expect(handleChange).toHaveBeenCalledWith({ reasoningEffort: "medium" });
  });
});
