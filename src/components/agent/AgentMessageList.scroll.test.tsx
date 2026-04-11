import { render, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMessageList } from "./AgentMessageList";
import type { AgentMessage } from "../../lib/agent/types";

function createMessages(text: string): AgentMessage[] {
  return [
    {
      id: "assistant-1",
      role: "assistant",
      author: "主代理",
      parts: [{ type: "text", text }],
    },
  ];
}

function attachScrollMetrics(element: HTMLDivElement, metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  let clientHeight = metrics.clientHeight;
  let scrollHeight = metrics.scrollHeight;
  let scrollTop = metrics.scrollTop;

  Object.defineProperties(element, {
    clientHeight: {
      configurable: true,
      get: () => clientHeight,
    },
    scrollHeight: {
      configurable: true,
      get: () => scrollHeight,
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });

  return {
    setClientHeight(value: number) {
      clientHeight = value;
    },
    setScrollHeight(value: number) {
      scrollHeight = value;
    },
    setScrollTop(value: number) {
      scrollTop = value;
    },
    getScrollTop() {
      return scrollTop;
    },
  };
}

describe("AgentMessageList scroll", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("贴近底部时会在流式更新中继续自动跟随", async () => {
    const view = render(<AgentMessageList messages={createMessages("第一段")} runStatus="completed" />);
    const scroller = view.container.firstElementChild as HTMLDivElement;
    const metrics = attachScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 500,
      scrollTop: 290,
    });

    fireEvent.scroll(scroller);
    metrics.setScrollHeight(560);
    view.rerender(<AgentMessageList messages={createMessages("第一段\n\n第二段")} runStatus="completed" />);

    await waitFor(() => {
      expect(metrics.getScrollTop()).toBe(560);
    });
  });

  it("手动上滑后流式更新不会强制拉回到底部", async () => {
    const view = render(<AgentMessageList messages={createMessages("第一段")} runStatus="completed" />);
    const scroller = view.container.firstElementChild as HTMLDivElement;
    const metrics = attachScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 500,
      scrollTop: 120,
    });

    fireEvent.scroll(scroller);
    metrics.setScrollHeight(560);
    view.rerender(<AgentMessageList messages={createMessages("第一段\n\n第二段")} runStatus="completed" />);

    await waitFor(() => {
      expect(metrics.getScrollTop()).toBe(120);
    });
  });
});
