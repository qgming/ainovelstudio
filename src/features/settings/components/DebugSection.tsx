import { useEffect, useMemo, useState } from "react";
import { Bug, Clipboard, Database, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { clearAiCallLogs, readAiCallLogs } from "@features/settings/debug/api";
import type { AiCallLogEntry } from "@features/settings/debug/types";
import { Button } from "@shared/ui/button";
import { SettingsHeaderResponsiveButton, SettingsSectionHeader } from "./SettingsSectionHeader";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type PayloadView = "request" | "response";

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
});

function formatLogTime(value: string) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "未知时间";
  return timeFormatter.format(new Date(timestamp));
}

function formatEndpoint(value: string) {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function formatPayload(value: string) {
  if (!value.trim()) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function StatusBadge({ log }: { log: AiCallLogEntry }) {
  return (
    <span
      className={[
        "inline-flex h-6 shrink-0 items-center border px-2 text-[11px] font-medium",
        log.ok
          ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
          : "border-destructive/25 bg-destructive/8 text-destructive",
      ].join(" ")}
    >
      {log.status || "ERR"}
    </span>
  );
}

function EmptyState({ errorMessage, status }: { errorMessage: string | null; status: LoadStatus }) {
  return (
    <div className="editor-empty-state min-h-[280px]">
      <div>
        <Database className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-4 text-lg font-medium tracking-[-0.03em] text-foreground">
          {status === "error" ? "读取调用日志失败" : "暂无调用日志"}
        </p>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {status === "error"
            ? errorMessage || "请稍后刷新重试。"
            : "完成一次 AI 调用后，这里会显示该次调用的请求 JSON 和响应内容。"}
        </p>
      </div>
    </div>
  );
}

function PayloadPanel({
  activeView,
  onViewChange,
  value,
}: {
  activeView: PayloadView;
  onViewChange: (view: PayloadView) => void;
  value: string;
}) {
  const label = activeView === "request" ? "请求内容" : "响应内容";

  return (
    <section className="flex min-h-[520px] flex-1 flex-col overflow-hidden border border-border bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-panel-subtle px-2">
        <div className="inline-flex min-w-0 items-center border border-border bg-app">
          {[
            { key: "request" as const, label: "请求内容" },
            { key: "response" as const, label: "响应内容" },
          ].map((item) => {
            const isActive = activeView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={isActive}
                className={[
                  "h-8 px-3 text-sm font-medium transition",
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                ].join(" ")}
                onClick={() => onViewChange(item.key)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`复制${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(
              () => toast("已复制", { description: `${label}已写入剪贴板。` }),
              () => toast("复制失败", { description: "当前环境无法写入剪贴板。" }),
            );
          }}
          disabled={!value}
        >
          <Clipboard className="h-3.5 w-3.5" />
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-foreground">
        {formatPayload(value) || "空内容"}
      </pre>
    </section>
  );
}

export function DebugSection() {
  const [logs, setLogs] = useState<AiCallLogEntry[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [payloadView, setPayloadView] = useState<PayloadView>("request");
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadLogs() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const entries = await readAiCallLogs();
      setLogs(entries);
      setSelectedLogId((current) => current && entries.some((entry) => entry.id === current)
        ? current
        : entries[0]?.id ?? null);
      setStatus("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取调用日志失败。");
      setStatus("error");
    }
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  const selectedLog = useMemo(
    () => logs.find((log) => log.id === selectedLogId) ?? logs[0] ?? null,
    [logs, selectedLogId],
  );
  const selectedPayload = selectedLog
    ? payloadView === "request"
      ? selectedLog.requestJson
      : selectedLog.responseJson
    : "";

  async function handleClearLogs() {
    try {
      await clearAiCallLogs();
      setLogs([]);
      setSelectedLogId(null);
      toast("调用日志已清空");
    } catch (error) {
      toast("清空失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader
        title="开发调试"
        icon={<Bug className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-1">
            <SettingsHeaderResponsiveButton
              type="button"
              label="刷新调用日志"
              text="刷新"
              icon={<RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />}
              onClick={() => void loadLogs()}
              disabled={status === "loading"}
            />
            <SettingsHeaderResponsiveButton
              type="button"
              label="清空调用日志"
              text="清空"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => void handleClearLogs()}
              disabled={logs.length === 0}
            />
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col lg:flex-row">
          <aside className="max-h-[42%] min-h-[180px] shrink-0 overflow-y-auto border-b border-border bg-app lg:h-full lg:max-h-none lg:w-[320px] lg:border-r lg:border-b-0">
            <div className="flex h-10 items-center justify-between border-b border-border px-3">
              <p className="text-xs font-medium text-muted-foreground">AI 调用日志</p>
              <span className="text-xs text-muted-foreground">{logs.length}/100</span>
            </div>
            {logs.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                {status === "loading" ? "正在读取..." : "暂无日志"}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {logs.map((log) => {
                  const isActive = selectedLog?.id === log.id;
                  return (
                    <button
                      key={log.id}
                      type="button"
                      className={[
                        "flex w-full flex-col gap-2 px-3 py-3 text-left transition",
                        isActive ? "bg-accent text-foreground" : "hover:bg-accent/60",
                      ].join(" ")}
                      onClick={() => setSelectedLogId(log.id)}
                    >
                      <div className="flex w-full items-center gap-2">
                        <StatusBadge log={log} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {log.modelId || "未知模型"}
                        </span>
                      </div>
                      <div className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{formatEndpoint(log.url)}</span>
                        <span className="shrink-0">{formatLogTime(log.createdAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!selectedLog ? (
              <EmptyState errorMessage={errorMessage} status={status} />
            ) : (
              <div className="flex min-h-full flex-col gap-3">
                <div className="border border-border bg-panel px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge log={selectedLog} />
                    <span className="text-sm font-medium text-foreground">
                      {selectedLog.method} {formatEndpoint(selectedLog.url)}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatLogTime(selectedLog.createdAt)}</span>
                  </div>
                  {selectedLog.error ? (
                    <p className="mt-2 text-sm text-destructive">{selectedLog.error}</p>
                  ) : null}
                </div>
                <PayloadPanel
                  activeView={payloadView}
                  onViewChange={setPayloadView}
                  value={selectedPayload}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
