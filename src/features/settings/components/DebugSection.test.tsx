import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DebugSection } from "./DebugSection";

const { clearAiCallLogsMock, readAiCallLogsMock, toastMock } = vi.hoisted(() => ({
  clearAiCallLogsMock: vi.fn(),
  readAiCallLogsMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@features/settings/debug/api", () => ({
  clearAiCallLogs: clearAiCallLogsMock,
  readAiCallLogs: readAiCallLogsMock,
}));

describe("DebugSection", () => {
  beforeEach(() => {
    toastMock.mockReset();
    clearAiCallLogsMock.mockReset();
    readAiCallLogsMock.mockReset();
    readAiCallLogsMock.mockResolvedValue([
      {
        id: "log-1",
        createdAt: String(Date.now()),
        method: "POST",
        url: "https://api.example.com/v1/chat/completions",
        modelId: "gpt-test",
        status: 200,
        ok: true,
        requestJson: JSON.stringify({
          model: "gpt-test",
          messages: [{ role: "user", content: "hello\nsecond line" }],
          temperature: 0.7,
        }),
        responseJson: JSON.stringify({
          id: "resp-1",
          choices: [{ message: { content: "world" } }],
        }),
        error: "",
      },
    ]);
  });

  it("保持 JSON 样式，字符串内容默认一行并可单独展开", async () => {
    render(<DebugSection />);

    await screen.findByRole("button", { name: "切换字符串 $.messages[0].content" });

    expect(screen.getByText('"model":')).toBeInTheDocument();
    expect(screen.getByText('"messages":')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换字符串 $.model" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "切换字符串 $.messages[0].content" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "切换字符串 $.messages[0].content" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "切换字符串 $.messages[0].content" })).toHaveAttribute("aria-expanded", "true");
    });

    expect(screen.getByRole("button", { name: "切换字符串 $.model" })).toHaveAttribute("aria-expanded", "false");
  });

  it("含 Rust 诊断的错误日志：默认显示摘要、可展开 UTF-8 / 16 进制视图", async () => {
    readAiCallLogsMock.mockReset();
    readAiCallLogsMock.mockResolvedValue([
      {
        id: "log-err",
        createdAt: String(Date.now()),
        method: "POST",
        url: "https://api.example.com/v1/chat/completions",
        modelId: "gpt-test",
        status: 0,
        ok: false,
        requestJson: "{}",
        responseJson: "",
        error: [
          "error decoding response body: invalid chunk",
          "",
          "[diagnostic: last 32 of 1024 buffered bytes]",
          "[utf-8 lossy]:",
          "{\n\"id\":\"x\"\n\"choices\":[]\n}",
          "[hex]:",
          "7b 0a 22 69 64 22 3a 22 78 22",
        ].join("\n"),
      },
    ]);

    render(<DebugSection />);

    // 摘要先出现
    await screen.findByText(/error decoding response body: invalid chunk/);
    // 默认收起
    expect(screen.queryByRole("button", { name: "UTF-8 解码" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /查看诊断详情/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "UTF-8 解码" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "UTF-8 解码" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/\[diagnostic: last 32 of 1024 buffered bytes\]/)).toBeInTheDocument();
    expect(screen.getByText(/"choices":\[\]/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "16 进制" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "16 进制" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByText(/7b 0a 22 69 64 22/)).toBeInTheDocument();
  });

  it("没有诊断段的旧错误日志：直接平铺显示完整 error 文本", async () => {
    readAiCallLogsMock.mockReset();
    readAiCallLogsMock.mockResolvedValue([
      {
        id: "log-legacy",
        createdAt: String(Date.now()),
        method: "POST",
        url: "https://api.example.com/v1/chat/completions",
        modelId: "gpt-test",
        status: 401,
        ok: false,
        requestJson: "{}",
        responseJson: "",
        error: "Unauthorized: invalid API key",
      },
    ]);

    render(<DebugSection />);
    await screen.findByText("Unauthorized: invalid API key");
    // 不应出现"查看诊断详情"
    expect(screen.queryByRole("button", { name: /查看诊断详情/ })).toBeNull();
  });
});
