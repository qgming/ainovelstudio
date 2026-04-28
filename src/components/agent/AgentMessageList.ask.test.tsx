import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentMessageList } from "./AgentMessageList";

describe("AgentMessageList ask 状态", () => {
  it("awaiting_user 时隐藏思考尾巴并保留 ask 卡片", () => {
    render(
      <AgentMessageList
        runStatus="awaiting_user"
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            author: "主代理",
            parts: [
              { type: "placeholder", text: "正在思考" },
              {
                type: "ask-user",
                toolName: "ask",
                toolCallId: "ask-1",
                status: "awaiting_user",
                title: "你更想往哪个方向推进？",
                selectionMode: "single",
                options: [
                  { id: "plot", label: "推进主线" },
                  { id: "__custom__", label: "用户输入" },
                ],
                customOptionId: "__custom__",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("询问用户")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-thinking-tail")).not.toBeInTheDocument();
    expect(screen.queryAllByText("正在思考")).toHaveLength(0);
  });
});
