import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookAgentPanel } from "../book/BookAgentPanel";
import { useAgentStore } from "../../stores/agentStore";

describe("BookAgentPanel", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("初始状态下渲染新的顶部结构和输入框", () => {
    render(<BookAgentPanel width={420} />);

    expect(screen.getByRole("button", { name: "Agent 面板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开历史记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始新对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeInTheDocument();
    expect(screen.queryByText("未配置模型")).not.toBeInTheDocument();
    expect(screen.queryByText("空闲")).not.toBeInTheDocument();
    // 初始无消息，不应有思考/工具卡片
    expect(screen.queryByText("思考")).not.toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("工具运行中与完成后使用同一个工具卡片展示状态", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "tool-call",
                toolName: "read_workspace_tree",
                status: "running",
                inputSummary: "{}",
              },
            ],
          },
        ],
      },
    });

    const { rerender } = render(<BookAgentPanel width={420} />);

    expect(screen.getByText("read_workspace_tree")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();

    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              {
                type: "tool-call",
                toolName: "read_workspace_tree",
                status: "completed",
                inputSummary: "{}",
                outputSummary: '{"name":"北境余烬","children":[{"name":"章节"}]}',
              },
            ],
          },
        ],
      },
    });

    rerender(<BookAgentPanel width={420} />);

    expect(screen.getByText("运行成功")).toBeInTheDocument();
    expect(screen.queryAllByText("read_workspace_tree")).toHaveLength(1);
  });

  it("运行中时显示停止按钮并可终止输出", () => {
    const abort = vi.fn();
    useAgentStore.setState({
      abortController: { abort } as unknown as AbortController,
      run: {
        id: "run-test",
        status: "running",
        title: "",
        messages: [],
      },
    });

    render(<BookAgentPanel width={420} />);

    const stopButton = screen.getByRole("button", { name: "停止输出" });
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("手动设置消息后可以渲染特殊 part 卡片", () => {
    useAgentStore.setState({
      run: {
        id: "run-test",
        status: "completed",
        title: "",
        messages: [
          {
            id: "user-1",
            role: "user",
            author: "你",
            parts: [{ type: "text", text: "请帮我续写" }],
          },
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              { type: "text", text: "正在处理..." },
              { type: "tool-call", toolName: "read_file", status: "completed", inputSummary: "读取章节" },
            ],
          },
        ],
      },
    });

    render(<BookAgentPanel width={420} />);

    expect(screen.getByText("请帮我续写")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("支持输入并追加用户消息", () => {
    render(<BookAgentPanel width={420} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Agent 输入框" }), {
      target: { value: "继续扩写这一章" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(screen.getByText("继续扩写这一章")).toBeInTheDocument();
  });
});
