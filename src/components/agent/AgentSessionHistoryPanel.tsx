import { MessageSquareText, Trash2 } from "lucide-react";
import type { ChatSessionSummary } from "../../lib/chat/types";

type AgentSessionHistoryPanelProps = {
  activeSessionId: string | null;
  disabled?: boolean;
  onDelete: (sessionId: string) => void;
  onSelect: (sessionId: string) => void;
  sessions: ChatSessionSummary[];
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "刚刚";
  }

  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export function AgentSessionHistoryPanel({
  activeSessionId,
  disabled = false,
  onDelete,
  onSelect,
  sessions,
}: AgentSessionHistoryPanelProps) {
  return (
    <section className="shrink-0 border-b border-[#e2e8f0] bg-white/85 px-2 py-2 backdrop-blur-sm dark:border-[#20242b] dark:bg-[#15171be0]">
      <div className="mb-2 flex items-center justify-between px-1">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#64748b] dark:text-[#94a3b8]">
            历史会话
          </p>
          <p className="mt-1 text-xs text-[#94a3b8] dark:text-[#64748b]">所有对话都会保存在本地 SQLite</p>
        </div>
        <span className="rounded-full bg-[#eef2ff] px-2 py-1 text-[11px] font-medium text-[#4f46e5] dark:bg-[#1f2532] dark:text-[#c7d2fe]">
          {sessions.length} 条
        </span>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <div
              key={session.id}
              className={`group flex items-stretch gap-2 rounded-[12px] border px-2 py-2 transition-colors ${
                isActive
                  ? "border-[#c7d2fe] bg-[#eef2ff] dark:border-[#334155] dark:bg-[#19202b]"
                  : "border-transparent bg-[#f8fafc] hover:border-[#dbe4f0] hover:bg-[#f1f5f9] dark:bg-[#111318] dark:hover:border-[#2a3342] dark:hover:bg-[#171b22]"
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(session.id)}
                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 shrink-0 text-[#64748b] dark:text-[#94a3b8]" />
                  <p className="truncate text-sm font-medium text-[#0f172a] dark:text-[#e2e8f0]">{session.title}</p>
                  {isActive ? (
                    <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#4338ca] dark:bg-[#0f172a] dark:text-[#c7d2fe]">
                      当前
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#64748b] dark:text-[#94a3b8]">
                  {session.summary || "暂无摘要，发送消息后会自动生成。"}
                </p>
                <p className="mt-1 text-[11px] text-[#94a3b8] dark:text-[#64748b]">{formatTimestamp(session.lastMessageAt ?? session.updatedAt)}</p>
              </button>
              <button
                type="button"
                aria-label={`删除会话 ${session.title}`}
                disabled={disabled || isActive}
                onClick={() => onDelete(session.id)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[#94a3b8] transition hover:bg-[#fee2e2] hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-[#35191c] dark:hover:text-[#fca5a5]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
