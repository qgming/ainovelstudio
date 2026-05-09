import { useEffect, useRef, memo } from "react";
import { AgentPartRenderer } from "./AgentPartRenderer";
import type { AgentMessage, AgentRunStatus } from "@features/agent/lib/types";

type AgentMessageListProps = {
  messages: AgentMessage[];
  runStatus: AgentRunStatus;
};

const BOTTOM_THRESHOLD = 24;
const MAX_RENDERED_MESSAGES = 80;

type MessageBubbleProps = {
  renderMarkdown: boolean;
  message: AgentMessage;
};

type ThinkingTailProps = {
  visible: boolean;
};

function isNearBottom(element: HTMLDivElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
}

const MessageBubble = memo(function MessageBubble({ message, renderMarkdown }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[94%] space-y-2 ${isUser ? "items-end" : "items-start"}`}>
        {message.parts.map((part, index) => {
          if (part.type === "placeholder") {
            return null;
          }

          if (part.type === "text") {
            return (
              <div
                key={`${message.id}-${index}`}
                className={`rounded-md text-sm ${
                  isUser
                    ? "bg-message-card px-3 py-2 text-foreground"
                    : "bg-message-card px-3.5 py-2.5 text-foreground"
                }`}
              >
                <AgentPartRenderer part={part} renderMarkdown={renderMarkdown} />
              </div>
            );
          }

          return <AgentPartRenderer key={`${message.id}-${index}`} part={part} renderMarkdown={renderMarkdown} />;
        })}
      </div>
    </article>
  );
});

const ThinkingTail = memo(function ThinkingTail({ visible }: ThinkingTailProps) {
  if (!visible) {
    return null;
  }

  return (
    <article className="flex justify-start" data-testid="agent-thinking-tail">
      <div className="max-w-[94%] px-1 py-1 text-sm text-muted-foreground">
        <AgentPartRenderer part={{ type: "placeholder", text: "正在思考" }} />
      </div>
    </article>
  );
});

export function AgentMessageList({ messages, runStatus }: AgentMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const lastMessageId = messages.at(-1)?.id ?? null;
  const showThinkingTail = runStatus === "running";
  const isAwaitingUser = runStatus === "awaiting_user";
  const streamingMessageId = runStatus === "running" ? lastMessageId : null;

  const allDisplayMessages = isAwaitingUser
    ? messages.filter((message) =>
        message.role !== "assistant"
        || message.parts.some((part) => part.type !== "placeholder"),
      )
    : messages;
  const skippedMessageCount = Math.max(0, allDisplayMessages.length - MAX_RENDERED_MESSAGES);
  const displayMessages = skippedMessageCount > 0
    ? allDisplayMessages.slice(skippedMessageCount)
    : allDisplayMessages;

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldAutoScrollRef.current) {
      return;
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || lastMessageId === null) {
      return;
    }

    shouldAutoScrollRef.current = true;
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      el.scrollTop = el.scrollHeight;
    });
  }, [lastMessageId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    shouldAutoScrollRef.current = isNearBottom(el);
  };

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-app px-3 py-3">
      <div className="space-y-4">
        {skippedMessageCount > 0 ? (
          <div className="mx-auto max-w-[94%] rounded-md border border-border bg-panel-subtle px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
            已折叠 {skippedMessageCount} 条较早消息，当前仅渲染最近 {MAX_RENDERED_MESSAGES} 条以保持长时间运行流畅。
          </div>
        ) : null}
        {displayMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            renderMarkdown={message.id !== streamingMessageId}
          />
        ))}
        <ThinkingTail visible={showThinkingTail} />
      </div>
    </div>
  );
}
