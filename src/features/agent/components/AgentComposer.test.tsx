import { fireEvent, render, screen } from "@testing-library/react";
import { Sparkles } from "lucide-react";
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

    const planPanel = screen.getByLabelText("待办计划");
    expect(planPanel.className).toContain("rounded-t-[8px]");
    expect(planPanel.className).toContain("border-b-0");
    expect(planPanel.className).toContain("bg-card");
    expect(planPanel.parentElement?.className).toContain("px-3");
    expect(planPanel.parentElement?.className).not.toContain("pb-1");
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
    expect(toggle.innerHTML).toContain("lucide-chevron-down");
    expect(toggle.innerHTML).not.toContain("lucide-minimize-2");
    fireEvent.click(toggle);

    expect(screen.queryByText("1. Inspect the runtime")).not.toBeInTheDocument();
    const collapsedToggle = screen.getByRole("button", { name: "展开待办计划" });
    expect(collapsedToggle).toBeInTheDocument();
    expect(collapsedToggle.innerHTML).toContain("lucide-chevron-right");
    expect(collapsedToggle.innerHTML).not.toContain("lucide-maximize-2");
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
      filePaths: [],
      skillIds: [],
    });
  });

  it("输入区默认显示为两行高度", () => {
    render(<AgentComposer {...buildComposerProps()} />);

    const textarea = screen.getByLabelText("Agent 输入框");
    expect(textarea).toHaveAttribute("rows", "2");
    expect(textarea).toHaveAttribute("placeholder", "输入想法、问题或要处理的任务");
    expect(textarea.parentElement?.className).toContain("rounded-t-[8px]");
    expect(textarea.parentElement?.className).toContain("border-x");
    expect(textarea.parentElement?.className).toContain("border-t");
  });

  it("输入区超过最大高度后在内部滚动", () => {
    const scrollHeightMock = vi
      .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
      .mockReturnValue(260);

    render(<AgentComposer {...buildComposerProps()} input={"很长的输入\n".repeat(20)} />);

    const textarea = screen.getByLabelText("Agent 输入框");
    expect(textarea).toHaveStyle({ maxHeight: "240px", height: "240px", overflowY: "auto" });

    scrollHeightMock.mockRestore();
  });

  it("默认输入为空时显示不可点击的发送按钮", () => {
    render(<AgentComposer {...buildComposerProps()} input="   " />);

    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });

  it("用户输入内容后发送按钮可点击", () => {
    const handleSubmit = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        input="继续写下一段"
        onSubmit={handleSubmit}
      />,
    );

    const sendButton = screen.getByRole("button", { name: "发送消息" });
    expect(sendButton).toBeInTheDocument();

    fireEvent.click(sendButton);

    expect(handleSubmit).toHaveBeenCalledWith({
      filePaths: [],
      skillIds: [],
    });
  });

  it("默认模式菜单只显示协作和目标模式", () => {
    render(<AgentComposer {...buildComposerProps()} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "当前模式：协作" }), {
      button: 0,
      ctrlKey: false,
    });

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: /目标/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /协作/ })).toBeInTheDocument();
  });

  it("默认显示协作模式并支持切换到目标模式", () => {
    const handleModeChange = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        modes={[
          { id: "book", label: "协作", description: "默认对话与任务执行模式", icon: Sparkles },
          { id: "goal", label: "目标", description: "按目标持续执行", icon: Sparkles },
        ]}
        onModeChange={handleModeChange}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "当前模式：协作" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /目标/ }));

    expect(handleModeChange).toHaveBeenCalledWith("goal");
    expect(screen.getByRole("button", { name: "当前模式：目标" })).toBeInTheDocument();
    expect(screen.getByLabelText("Agent 输入框")).toHaveAttribute(
      "placeholder",
      "输入目标：Agent 会持续执行、验证和回写，直到目标完成或真实阻塞",
    );
  });

  it("运行中输入为空时只显示停止按钮", () => {
    render(<AgentComposer {...buildComposerProps()} runStatus="running" />);

    expect(screen.getByRole("button", { name: "停止输出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送纠偏" })).not.toBeInTheDocument();
  });

  it("运行中输入内容后把停止按钮切换成发送纠偏按钮", () => {
    const handleSubmit = vi.fn();

    render(
      <AgentComposer
        {...buildComposerProps()}
        input="补充：优先保留伏笔"
        onSubmit={handleSubmit}
        runStatus="running"
      />,
    );

    const steerButton = screen.getByRole("button", { name: "发送纠偏" });
    expect(steerButton).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止输出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();

    fireEvent.click(steerButton);

    expect(handleSubmit).toHaveBeenCalledWith({
      filePaths: [],
      skillIds: [],
    });
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
