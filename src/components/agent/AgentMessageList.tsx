import { useEffect, useRef } from "react";
import { AgentPartRenderer } from "./AgentPartRenderer";
import type { AgentMessage } from "../../lib/agent/types";

type AgentMessageListProps = {
  messages: AgentMessage[];
};

const BOTTOM_THRESHOLD = 24;

function isNearBottom(element: HTMLDivElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
}

export function AgentMessageList({ messages }: AgentMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastMessageId = messages.at(-1)?.id ?? null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && shouldAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || lastMessageId === null) {
      return;
    }

    shouldAutoScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
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
        {messages.map((message) => {
          const isUser = message.role === "user";

          return (
            <article key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[94%] space-y-2 ${isUser ? "items-end" : "items-start"}`}>
                {message.parts.map((part, index) => {
                  if (part.type === "text" || part.type === "placeholder") {
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
        })}
      </div>
    </div>
  );
}
