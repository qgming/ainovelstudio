import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPartRenderer } from "./AgentPartRenderer";

describe("AgentPartRenderer", () => {
  it("思考卡片展开后使用 Markdown 渲染", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "reasoning",
          summary: "**思考重点**",
          detail: "- 条目一\n- 条目二",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /思考/ }));

    expect(screen.getByText("思考重点").tagName).toBe("STRONG");
    expect(screen.getByText("条目一").tagName).toBe("LI");
    expect(screen.getByText("条目二").tagName).toBe("LI");
  });

  it("工具卡片展开后对输入和输出都使用 Markdown 渲染", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "read_file",
          status: "completed",
          inputSummary: "- 章节/第一章.md",
          outputSummary: "```json\n{\"ok\":true}\n```",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /read_file/ }));

    expect(screen.getByText("章节/第一章.md").tagName).toBe("LI");
    const codeBlock = screen.getByText('{"ok":true}');
    expect(codeBlock.tagName).toBe("CODE");
    expect(codeBlock.closest("pre")).not.toBeNull();
  });

  it("工具卡片会格式化显示 JSON 参数和结果", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "tool-call",
          toolName: "read_workspace_tree",
          status: "completed",
          inputSummary: '{"path":"章节/第一章.md","deep":true}',
          outputSummary: '{"name":"北境余烬","children":[{"name":"章节"}]}',
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /read_workspace_tree/ }));

    const codeBlocks = screen.getAllByText((_, element) => element?.tagName === "CODE");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toHaveTextContent('"path": "章节/第一章.md"');
    expect(codeBlocks[0]).toHaveTextContent('"deep": true');
    expect(codeBlocks[1]).toHaveTextContent('"name": "北境余烬"');
    expect(codeBlocks[1]).toHaveTextContent('"children": [');
  });

  it("思考卡片展开后点击内容区域可以折叠", () => {
    render(
      <AgentPartRenderer
        part={{
          type: "reasoning",
          summary: "思考中...",
          detail: "正在分析请求。",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /思考/ }));
    expect(screen.getByText("正在分析请求。")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(screen.queryByText("正在分析请求。")).not.toBeInTheDocument();
  });
});
