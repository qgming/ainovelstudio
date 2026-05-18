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
});
