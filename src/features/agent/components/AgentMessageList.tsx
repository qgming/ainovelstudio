import { useEffect, useRef, useState, memo } from "react";
import { ChevronDown, CircleCheck, CircleX, Eye, LoaderCircle } from "lucide-react";
import { AgentPartRenderer, ToolOutputPanel, normalizeRenderableStatus } from "./AgentPartRenderer";
import type { AgentMessage, AgentPart, AgentRunStatus } from "@features/agent/lib/types";

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

type ToolCallPart = Extract<AgentPart, { type: "tool-call" }>;

type MessageRenderBlock =
  | { kind: "part"; index: number; part: AgentPart }
  | { kind: "tool-group"; endIndex: number; parts: ToolCallPart[]; startIndex: number };

const COMPACT_TOOL_EXCLUSIONS = new Set(["update_plan", "yolo_control"]);

function isNearBottom(element: HTMLDivElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD;
}

function isCompactToolCall(part: AgentPart): part is ToolCallPart {
  return part.type === "tool-call" && !COMPACT_TOOL_EXCLUSIONS.has(part.toolName);
}

function groupMessageParts(parts: AgentPart[]): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];
  let pendingTools: ToolCallPart[] = [];
  let pendingStart = 0;

  const flushTools = (endIndex: number) => {
    if (pendingTools.length === 0) return;
    blocks.push({ kind: "tool-group", endIndex, parts: pendingTools, startIndex: pendingStart });
    pendingTools = [];
  };

  parts.forEach((part, index) => {
    if (isCompactToolCall(part)) {
      if (pendingTools.length === 0) pendingStart = index;
      pendingTools.push(part);
      return;
    }

    flushTools(index - 1);
    blocks.push({ kind: "part", index, part });
  });

  flushTools(parts.length - 1);
  return blocks;
}

function readJsonTarget(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const directKeys = ["path", "filePath", "targetPath", "sourcePath", "url", "query", "pattern", "command"];
  for (const key of directKeys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }

  const listKeys = ["paths", "files", "filePaths"];
  for (const key of listKeys) {
    const list = record[key];
    if (Array.isArray(list)) {
      const values = list.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (values.length > 0) return values.slice(0, 2).join("、") + (values.length > 2 ? ` 等 ${values.length} 项` : "");
    }
  }

  return null;
}

function getToolTarget(part: ToolCallPart) {
  const input = part.inputSummary.trim();
  if (!input) return part.toolName;

  try {
    const parsed = JSON.parse(input) as unknown;
    const target = readJsonTarget(parsed);
    if (target) return target;
    return part.toolName;
  } catch {
    // Non-JSON summaries are already display text.
  }

  return input.split(/\r?\n/)[0]?.replace(/^[-*]\s*/, "").trim() || part.toolName;
}

function getToolActionLabel(part: ToolCallPart) {
  const status = normalizeRenderableStatus(part.status);
  if (status === "running") return "正在执行任务";
  if (status === "failed") return "执行失败";

  const name = part.toolName.toLowerCase();
  if (/search/.test(name)) return "已搜索";
  if (/read|list|tree|get|fetch|load/.test(name)) return "已读取";
  if (/create|write|save/.test(name)) return "创建";
  if (/edit|replace|update|patch|apply/.test(name)) return "编辑";
  if (/delete|remove/.test(name)) return "删除";
  return "已执行";
}

function ToolStatusIcon({ status }: { status: AgentRunStatus }) {
  const normalized = normalizeRenderableStatus(status);
  const labelMap = {
    idle: "空闲",
    running: "运行中",
    completed: "运行成功",
    failed: "运行失败",
  } as const;
  const icon = normalized === "running"
    ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    : normalized === "failed"
      ? <CircleX aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
      : <CircleCheck aria-hidden="true" className="h-3.5 w-3.5 text-emerald-500" />;

  return (
    <span aria-label={labelMap[normalized]} title={labelMap[normalized]} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      {icon}
    </span>
  );
}

const ToolStepGroup = memo(function ToolStepGroup({ parts }: { parts: ToolCallPart[] }) {
  const [open, setOpen] = useState(false);
  const [openToolCallId, setOpenToolCallId] = useState<string | null>(null);

  return (
    <section className="text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-8 w-full items-center gap-2 px-1 py-0.5 text-left text-[15px] font-medium leading-6 text-muted-foreground"
      >
        <Eye aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>查看 {parts.length} 个步骤</span>
        <ChevronDown
          aria-hidden="true"
          className={["h-3.5 w-3.5 shrink-0 transition-transform", open ? "rotate-180" : ""].join(" ")}
        />
      </button>
      {open ? (
        <div className="ml-4 border-l border-border py-1 pl-4">
          <div className="space-y-1">
            {parts.map((part) => {
              const expanded = openToolCallId === part.toolCallId;
              const target = getToolTarget(part);
              return (
                <div key={part.toolCallId} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setOpenToolCallId(expanded ? null : part.toolCallId)}
                    className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-[6px] px-1 py-0.5 text-left text-[15px] leading-6 text-muted-foreground hover:bg-accent/45 hover:text-foreground"
                  >
                    <ToolStatusIcon status={part.status} />
                    <span className="shrink-0 font-medium text-foreground/80">{getToolActionLabel(part)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{target}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={["h-3.5 w-3.5 shrink-0 transition-transform", expanded ? "rotate-180" : ""].join(" ")}
                    />
                  </button>
                  {expanded ? (
                    <div className="pl-7 pr-1 pb-2 pt-1">
                      <ToolOutputPanel
                        emptyText={part.status === "running" || part.status === "awaiting_user" ? "正在等待工具返回结果。" : "无输出内容。"}
                        outputSummary={part.outputSummary}
                        validationError={part.validationError}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
});

const MessageBubble = memo(function MessageBubble({ message, renderMarkdown }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const blocks = groupMessageParts(message.parts);

  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[94%] space-y-2 ${isUser ? "items-end" : "items-start"}`}>
        {blocks.map((block) => {
          if (block.kind === "tool-group") {
            return <ToolStepGroup key={`${message.id}-tools-${block.startIndex}-${block.endIndex}`} parts={block.parts} />;
          }

          const { index, part } = block;
          if (part.type === "placeholder") {
            return null;
          }

          if (part.type === "text") {
            return (
              <div
                key={`${message.id}-${index}`}
                className={`text-sm ${
                  isUser
                    ? "rounded-[14px] bg-message-card px-4 py-2.5 text-foreground"
                    : "px-1 py-0 text-black dark:text-white"
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
    <div ref={scrollRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card px-3 py-3 text-card-foreground dark:bg-panel">
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
