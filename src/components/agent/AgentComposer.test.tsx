import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentComposer } from "./AgentComposer";

describe("AgentComposer", () => {
  it("在输入区上方显示当前会话待办计划和提醒", () => {
    render(
      <AgentComposer
        input=""
        onInputChange={vi.fn()}
        onStop={vi.fn()}
        onSubmit={vi.fn()}
        planningState={{
          items: [
            { content: "Inspect the runtime", status: "completed", activeForm: "" },
            { content: "Implement todo tool", status: "in_progress", activeForm: "Implementing todo tool" },
          ],
          roundsSinceUpdate: 3,
        }}
        resources={[]}
        rootNode={null}
        runStatus="idle"
      />,
    );

    expect(screen.getByText("共 2 个任务，已经完成 1 个")).toBeInTheDocument();
    expect(screen.getByText("1. Inspect the runtime")).toBeInTheDocument();
    expect(screen.getByText("2. Implement todo tool")).toBeInTheDocument();
    expect(screen.getByText("3 轮未更新")).toBeInTheDocument();
    expect(screen.getByText(/连续几轮没有刷新计划/)).toBeInTheDocument();
  });

  it("支持展开和收起待办计划", () => {
    render(
      <AgentComposer
        input=""
        onInputChange={vi.fn()}
        onStop={vi.fn()}
        onSubmit={vi.fn()}
        planningState={{
          items: [{ content: "Inspect the runtime", status: "completed", activeForm: "" }],
          roundsSinceUpdate: 0,
        }}
        resources={[]}
        rootNode={null}
        runStatus="idle"
      />,
    );

    const toggle = screen.getByRole("button", { name: "收起待办计划" });
    fireEvent.click(toggle);

    expect(screen.queryByText("1. Inspect the runtime")).not.toBeInTheDocument();
    expect(screen.getByText("点击右上角按钮可重新展开当前计划。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开待办计划" })).toBeInTheDocument();
  });

  it("回车发送时会带上当前手动选择", () => {
    const handleSubmit = vi.fn();

    render(
      <AgentComposer
        input="继续处理"
        onInputChange={vi.fn()}
        onStop={vi.fn()}
        onSubmit={handleSubmit}
        planningState={{ items: [], roundsSinceUpdate: 0 }}
        resources={[]}
        rootNode={null}
        runStatus="idle"
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Agent 输入框"), { key: "Enter" });

    expect(handleSubmit).toHaveBeenCalledWith({
      agentIds: [],
      filePaths: [],
      skillIds: [],
    });
  });
});
