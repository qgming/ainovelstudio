import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentComposer } from "./AgentComposer";

const buildComposerProps = () => ({
  input: "",
  onCoach: vi.fn(),
  onInputChange: vi.fn(),
  onStop: vi.fn(),
  onSubmit: vi.fn(),
  onSubmitAskAnswer: vi.fn(),
  pendingAsk: null,
  planningState: { items: [], roundsSinceUpdate: 0 },
  resources: [],
  rootNode: null,
  runStatus: "idle" as const,
});

describe("AgentComposer", () => {
  it("在输入区上方显示当前会话待办计划和提醒", () => {
    render(
      <AgentComposer
        {...buildComposerProps()}
        planningState={{
          items: [
            { content: "Inspect the runtime", status: "completed", activeForm: "" },
            { content: "Implement todo tool", status: "in_progress", activeForm: "Implementing todo tool" },
          ],
          roundsSinceUpdate: 3,
        }}
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
        {...buildComposerProps()}
        planningState={{
          items: [{ content: "Inspect the runtime", status: "in_progress", activeForm: "Inspecting the runtime" }],
          roundsSinceUpdate: 0,
        }}
      />,
    );

    const toggle = screen.getByRole("button", { name: "收起待办计划" });
    fireEvent.click(toggle);

    expect(screen.queryByText("1. Inspect the runtime")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开待办计划" })).toBeInTheDocument();
  });

  it("没有任务时不显示待办计划", () => {
    render(<AgentComposer {...buildComposerProps()} />);

    expect(screen.queryByText(/共 .* 个任务/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /待办计划/ })).not.toBeInTheDocument();
  });

  it("所有任务完成时不显示待办计划", () => {
    render(
      <AgentComposer
        {...buildComposerProps()}
        planningState={{
          items: [{ content: "Inspect the runtime", status: "completed", activeForm: "" }],
          roundsSinceUpdate: 0,
        }}
      />,
    );

    expect(screen.queryByText(/共 .* 个任务/)).not.toBeInTheDocument();
    expect(screen.queryByText("1. Inspect the runtime")).not.toBeInTheDocument();
  });

  it("回车发送时会带上当前手动选择", () => {
    const handleSubmit = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        input="继续处理"
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Agent 输入框"), { key: "Enter" });

    expect(handleSubmit).toHaveBeenCalledWith({
      agentIds: [],
      filePaths: [],
      skillIds: [],
    });
  });

  it("输入区默认显示为两行高度", () => {
    render(<AgentComposer {...buildComposerProps()} />);

    expect(screen.getByLabelText("Agent 输入框")).toHaveAttribute("rows", "2");
  });

  it("ask 单选模式下可以选择预设项并确认", () => {
    const onSubmitAskAnswer = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        onSubmitAskAnswer={onSubmitAskAnswer}
        pendingAsk={{
          messageId: "assistant-1",
          toolCallId: "tool-ask-1",
          request: {
            title: "你更想往哪个方向推进？",
            selectionMode: "single",
            options: [
              { id: "plot", label: "推进主线" },
              { id: "emotion", label: "强化感情" },
              { id: "__custom__", label: "用户输入" },
            ],
            customOptionId: "__custom__",
            confirmLabel: "确认",
          },
          resolve: vi.fn(),
          reject: vi.fn(),
        }}
        runStatus="awaiting_user"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /推进主线/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(onSubmitAskAnswer).toHaveBeenCalledWith({
      selectionMode: "single",
      values: [
        {
          type: "option",
          id: "plot",
          label: "推进主线",
          value: "推进主线",
        },
      ],
      usedCustomInput: false,
      customInput: undefined,
    });
  });

  it("ask 选择用户输入后为空时不可确认，填写后可提交", () => {
    const onSubmitAskAnswer = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        onSubmitAskAnswer={onSubmitAskAnswer}
        pendingAsk={{
          messageId: "assistant-1",
          toolCallId: "tool-ask-2",
          request: {
            title: "请补充你的想法",
            selectionMode: "single",
            options: [
              { id: "preset", label: "使用预设" },
              { id: "__custom__", label: "用户输入" },
            ],
            customOptionId: "__custom__",
            customPlaceholder: "请输入补充说明",
            confirmLabel: "提交",
          },
          resolve: vi.fn(),
          reject: vi.fn(),
        }}
        runStatus="awaiting_user"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /用户输入/ }));

    const submitButton = screen.getByRole("button", { name: "提交" });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("用户输入"), { target: { value: "改成更悬疑一点" } });
    expect(submitButton).not.toBeDisabled();

    fireEvent.click(submitButton);

    expect(onSubmitAskAnswer).toHaveBeenCalledWith({
      selectionMode: "single",
      values: [
        {
          type: "custom",
          id: "__custom__",
          label: "用户输入",
          value: "改成更悬疑一点",
        },
      ],
      usedCustomInput: true,
      customInput: "改成更悬疑一点",
    });
  });

  it("ask 多选模式下支持预设项和用户输入一起提交", () => {
    const onSubmitAskAnswer = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        onSubmitAskAnswer={onSubmitAskAnswer}
        pendingAsk={{
          messageId: "assistant-1",
          toolCallId: "tool-ask-3",
          request: {
            title: "选择你要保留的方向",
            selectionMode: "multiple",
            options: [
              { id: "plot", label: "推进主线" },
              { id: "emotion", label: "强化感情" },
              { id: "__custom__", label: "用户输入" },
            ],
            customOptionId: "__custom__",
            maxSelections: 3,
            confirmLabel: "确认",
          },
          resolve: vi.fn(),
          reject: vi.fn(),
        }}
        runStatus="awaiting_user"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /推进主线/ }));
    fireEvent.click(screen.getByRole("button", { name: /强化感情/ }));
    fireEvent.click(screen.getByRole("button", { name: /用户输入/ }));
    fireEvent.change(screen.getByLabelText("用户输入"), { target: { value: "再加强压迫感" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(onSubmitAskAnswer).toHaveBeenCalledWith({
      selectionMode: "multiple",
      values: [
        {
          type: "option",
          id: "plot",
          label: "推进主线",
          value: "推进主线",
        },
        {
          type: "option",
          id: "emotion",
          label: "强化感情",
          value: "强化感情",
        },
        {
          type: "custom",
          id: "__custom__",
          label: "用户输入",
          value: "再加强压迫感",
        },
      ],
      usedCustomInput: true,
      customInput: "再加强压迫感",
    });
  });
});
