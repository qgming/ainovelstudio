import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPartRenderer } from "./AgentPartRenderer";

describe("AgentPartRenderer", () => {
  it("思考卡片展开后使用 Markdown 渲染", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "reasoning",
          summary: "",
          detail: "**思考重点**\n\n- 条目一\n- 条目二",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /思考/ }));

    expect(screen.getByText("思考重点").tagName).toBe("STRONG");
    expect(screen.getByText("条目一").tagName).toBe("LI");
    expect(screen.getByText("条目二").tagName).toBe("LI");
  });

  it("工具卡片展开后只渲染输出内容", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "read_file",
          toolCallId: "call-render-1",
          status: "completed",
          inputSummary: "- 章节/第一章.md",
          outputSummary: "```json\n{\"ok\":true}\n```",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /read_file/ }));

    expect(screen.queryByText("章节/第一章.md")).not.toBeInTheDocument();
    const codeBlock = screen.getByText('{"ok":true}');
    expect(codeBlock.tagName).toBe("CODE");
    expect(codeBlock.closest("pre")).not.toBeNull();
  });

  it("工具卡片会格式化显示 JSON 结果且不显示 JSON 参数", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "read_workspace_tree",
          toolCallId: "call-render-2",
          status: "completed",
          inputSummary: '{"path":"章节/第一章.md","deep":true}',
          outputSummary: '{"name":"北境余烬","children":[{"name":"章节"}]}',
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /read_workspace_tree/ }));

    const codeBlocks = screen.getAllByText((_, element) => element?.tagName === "CODE");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]).not.toHaveTextContent('"path": "章节/第一章.md"');
    expect(codeBlocks[0]).not.toHaveTextContent('"deep": true');
    expect(codeBlocks[0]).toHaveTextContent('"name": "北境余烬"');
    expect(codeBlocks[0]).toHaveTextContent('"children": [');
  });

  it("深度思考行可展开并再次点击折叠", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "reasoning",
          summary: "正在思考",
          detail: "正在分析请求。",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /深度思考/ }));
    expect(screen.getAllByText("正在分析请求。").length).toBeGreaterThan(0);
    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /深度思考/ }));
    expect(screen.queryByText("正在分析请求。")).not.toBeInTheDocument();
  });

  it("ask 卡片在等待输入时显示题面，在完成后显示已提交摘要", () => {
    const { rerender } = render(
      <AgentPartRenderer
        part={{
          type: "ask-user",
          toolName: "ask_user",
          toolCallId: "ask-1",
          status: "awaiting_user",
          title: "你更想往哪个方向推进？",
          description: "请选择一个方向。",
          selectionMode: "single",
          options: [
            { id: "plot", label: "推进主线" },
            { id: "__custom__", label: "用户输入" },
          ],
          customOptionId: "__custom__",
        }}
      />,
    );

    expect(screen.getByText("询问用户")).toBeInTheDocument();
    expect(screen.getByText("你更想往哪个方向推进？")).toBeInTheDocument();
    expect(screen.getByLabelText("运行中")).toBeInTheDocument();

    rerender(
      <AgentPartRenderer
        part={{
          type: "ask-user",
          toolName: "ask_user",
          toolCallId: "ask-1",
          status: "completed",
          title: "你更想往哪个方向推进？",
          selectionMode: "single",
          options: [
            { id: "plot", label: "推进主线" },
            { id: "__custom__", label: "用户输入" },
          ],
          customOptionId: "__custom__",
          answer: {
            selectionMode: "single",
            values: [{ type: "option", id: "plot", label: "推进主线", value: "推进主线" }],
            usedCustomInput: false,
          },
        }}
      />,
    );

    expect(screen.getByText(/已提交：推进主线/)).toBeInTheDocument();
    expect(screen.getByLabelText("运行成功")).toBeInTheDocument();
  });

  it("update_plan 工具调用渲染为任务进度卡片", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "update_plan",
          toolCallId: "plan-1",
          status: "completed",
          inputSummary: "{\"items\":[]}",
          output: {
            ok: true,
            summary: "[x] 定位问题\n[>] 修复 UI",
            data: {
              items: [
                { content: "定位问题", status: "completed", activeForm: "" },
                { content: "修复 UI", status: "in_progress", activeForm: "正在修复 UI" },
              ],
            },
          },
          outputSummary: "",
        }}
      />,
    );

    expect(screen.getByText("任务进度")).toBeInTheDocument();
    expect(screen.queryByText("1. 定位问题")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /任务进度/ }).innerHTML).not.toContain("lucide-chevron");

    fireEvent.click(screen.getByRole("button", { name: /任务进度/ }));

    const expandedButton = screen.getByRole("button", { name: /任务进度/ });
    expect(expandedButton.querySelectorAll("svg")).toHaveLength(1);
    expect(expandedButton.innerHTML).not.toContain("lucide-chevron");

    expect(screen.getByText("1. 定位问题")).toBeInTheDocument();
    expect(screen.getByText("2. 修复 UI")).toBeInTheDocument();
    expect(screen.getAllByText("正在修复 UI").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(screen.queryByText("1. 定位问题")).not.toBeInTheDocument();
  });

  it("展开后的折叠卡片使用更淡的背景", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "read_file",
          toolCallId: "call-render-bg",
          status: "completed",
          inputSummary: "{}",
          outputSummary: "已读取章节",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /read_file/ }));

    const card = screen.getByRole("button", { name: /read_file/ }).closest("section");
    expect(card?.className).toContain("bg-panel-subtle/70");
    expect(card?.className).not.toContain("bg-message-card");
  });

  it("目标检查卡片可展开并点击内容收起", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "goal_control",
          toolCallId: "goal-1",
          status: "completed",
          inputSummary: "{\"action\":\"complete\"}",
          output: {
            accepted: true,
            action: "complete",
            audit: ["完成第一章 -> 文件已写回"],
            createdAt: "2026-05-10T00:00:00.000Z",
            evidence: ["文件已写回"],
            goal: "完成第一章",
            kind: "goal-control",
            missing: [],
            reason: "验证完毕",
            remaining: [],
            stateUpdated: true,
            verification: ["已读取正文"],
          },
          outputSummary: "",
        }}
      />,
    );

    expect(screen.getByText("目标检查")).toBeInTheDocument();
    expect(screen.queryByText("验证完毕")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /目标检查/ }));
    expect(screen.getByText("验证完毕")).toBeInTheDocument();
    expect(screen.getByText("审计：完成第一章 -> 文件已写回")).toBeInTheDocument();
    expect(screen.getByText("证据：文件已写回")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(screen.queryByText("验证完毕")).not.toBeInTheDocument();
  });

});
