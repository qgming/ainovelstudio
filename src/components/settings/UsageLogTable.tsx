import { useEffect, useMemo, useState } from "react";
import type { UsageLogEntry } from "../../lib/usage/types";

const PAGE_SIZE = 20;

function formatSourceLabel(log: UsageLogEntry) {
  if (log.sourceType === "workflow") {
    return `工作流 · ${log.sourceName || log.sessionTitle || "未命名工作流"}`;
  }
  return `对话 · ${log.sourceName || log.sessionTitle || "未命名会话"}`;
}

export function UsageLogTable({
  errorMessage,
  filteredLogs,
  formatDateTime,
  formatMetric,
  status,
}: {
  errorMessage: string | null;
  filteredLogs: UsageLogEntry[];
  formatDateTime: (value: string) => string;
  formatMetric: (value: number) => string;
  status: "idle" | "loading" | "ready" | "error";
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [filteredLogs]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedLogs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, page]);

  return (
    <div className="mt-3 overflow-hidden border border-[#e2e8f0] dark:border-[#20242b]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-[#fafcff] dark:bg-[#11151a]">
            <tr className="border-b border-[#e2e8f0] dark:border-[#20242b]">
              {["时间", "来源", "书籍", "模型", "输入", "输出", "缓存命中", "缓存创建", "总计"].map((column) => (
                <th
                  key={column}
                  className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-[#94a3b8] dark:text-[#64748b]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {status === "loading" ? (
              <tr>
                <td className="px-4 py-8 text-sm text-[#64748b] dark:text-zinc-400" colSpan={9}>
                  正在读取用量日志...
                </td>
              </tr>
            ) : null}
            {status === "error" ? (
              <tr>
                <td className="px-4 py-8 text-sm text-[#b45309] dark:text-[#fbbf24]" colSpan={9}>
                  {errorMessage ?? "读取失败。"}
                </td>
              </tr>
            ) : null}
            {status === "ready" && filteredLogs.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-sm text-[#64748b] dark:text-zinc-400" colSpan={9}>
                  当前筛选条件下还没有可显示的日志。
                </td>
              </tr>
            ) : null}
            {status === "ready"
              ? pagedLogs.map((log) => (
                  <tr key={log.messageId} className="border-b border-[#e2e8f0] last:border-b-0 dark:border-[#20242b]">
                    <td className="whitespace-nowrap px-4 py-3 text-[#334155] dark:text-zinc-300">{formatDateTime(log.recordedAt || log.createdAt)}</td>
                    <td className="max-w-[240px] px-4 py-3 text-[#334155] dark:text-zinc-300">{formatSourceLabel(log)}</td>
                    <td className="max-w-[180px] px-4 py-3 text-[#334155] dark:text-zinc-300">{log.bookName || "未关联书籍"}</td>
                    <td className="max-w-[240px] px-4 py-3 font-medium text-[#0f172a] dark:text-zinc-100">{log.modelId || "未知模型"}</td>
                    <td className="px-4 py-3 font-mono text-[#0f172a] dark:text-zinc-100">{formatMetric(log.inputTokens)}</td>
                    <td className="px-4 py-3 font-mono text-[#0f172a] dark:text-zinc-100">{formatMetric(log.outputTokens)}</td>
                    <td className="px-4 py-3 font-mono text-[#0f172a] dark:text-zinc-100">{formatMetric(log.cacheReadTokens)}</td>
                    <td className="px-4 py-3 font-mono text-[#0f172a] dark:text-zinc-100">{formatMetric(log.cacheWriteTokens)}</td>
                    <td className="px-4 py-3 font-mono text-[#0f172a] dark:text-zinc-100">{formatMetric(log.totalTokens)}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      {status === "ready" && filteredLogs.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-[#e2e8f0] px-4 py-3 text-sm dark:border-[#20242b]">
          <span className="text-[#64748b] dark:text-zinc-400">
            第 {page} / {totalPages} 页，每页 20 条
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="inline-flex h-8 items-center rounded-[8px] border border-[#d7dde8] px-3 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="inline-flex h-8 items-center rounded-[8px] border border-[#d7dde8] px-3 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
