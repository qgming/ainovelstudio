import { useEffect, useRef, memo } from "react";
import { AgentPartRenderer } from "./AgentPartRenderer";
import type { AgentMessage, AgentRunStatus } from "../../lib/agent/types";

type AgentMessageListProps = {
  messages: AgentMessage[];
  runStatus: AgentRunStatus;
};

const BOTTOM_THRESHOLD = 24;

type MessageBubbleProps = {
  message: AgentMessage;
};

type ThinkingTailProps = {
  visible: boolean;
};

function isNearBottom(element: HTMLDivElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
}

const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
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
                className={`rounded-[10px] px-3.5 py-2.5 text-sm ${isUser ? "bg-[#111827] text-white dark:bg-[#f3f4f6] dark:text-[#111827]" : "border border-[#e2e8f0] bg-white text-[#1f2937] dark:border-[#20242b] dark:bg-[#15171b] dark:text-[#eef2f7]"}`}
              >
                <AgentPartRenderer part={part} />
              </div>
            );
          }

          return <AgentPartRenderer key={`${message.id}-${index}`} part={part} />;
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
      <div className="max-w-[94%] px-1 py-1 text-sm text-[#6b7280] dark:text-[#94a3b8]">
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
    <div ref={scrollRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <div className="space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <ThinkingTail visible={showThinkingTail} />
      </div>
    </div>
  );
}
