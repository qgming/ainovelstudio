import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bug, ChevronDown, ChevronRight, Clipboard, Database, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { clearAiCallLogs, readAiCallLogs } from "@features/settings/debug/api";
import type { AiCallLogEntry } from "@features/settings/debug/types";
import { Button } from "@shared/ui/button";
import { SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";

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

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function parsePayloadJson(value: string): JsonValue | string | null {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function formatJsonPrimitive(value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function buildPath(parentPath: string, key: string | number) {
  return typeof key === "number" ? `${parentPath}[${key}]` : `${parentPath}.${key}`;
}

function JsonStringValue({
  comma,
  expanded,
  onToggle,
  path,
  value,
}: {
  comma?: boolean;
  expanded: boolean;
  onToggle: (path: string) => void;
  path: string;
  value: string;
}) {
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`切换字符串 ${path}`}
        className="min-w-0 flex-1 rounded-[6px] text-left font-mono text-xs leading-5 text-foreground outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring/25"
        onClick={() => onToggle(path)}
      >
        <span className={expanded ? "block whitespace-pre-wrap break-words px-1" : "block truncate px-1"}>
          {JSON.stringify(value)}
        </span>
      </button>
      {comma ? <span className="shrink-0 text-muted-foreground">,</span> : null}
    </>
  );
}

function JsonLine({
  children,
  depth,
}: {
  children: ReactNode;
  depth: number;
}) {
  return (
    <div
      className="flex min-w-0 items-start font-mono text-xs leading-5"
      style={{ paddingLeft: depth * 16 }}
    >
      {children}
    </div>
  );
}

function JsonNode({
  comma = false,
  depth,
  expandedStrings,
  label,
  onToggleString,
  path,
  value,
}: {
  comma?: boolean;
  depth: number;
  expandedStrings: Set<string>;
  label?: string;
  onToggleString: (path: string) => void;
  path: string;
  value: JsonValue;
}) {
  const prefix = label ? <span className="shrink-0 text-muted-foreground">{JSON.stringify(label)}: </span> : null;

  if (typeof value === "string") {
    return (
      <JsonLine depth={depth}>
        {prefix}
        <JsonStringValue
          comma={comma}
          expanded={expandedStrings.has(path)}
          onToggle={onToggleString}
          path={path}
          value={value}
        />
      </JsonLine>
    );
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return (
      <JsonLine depth={depth}>
        {prefix}
        <span className="min-w-0 break-words text-foreground">{formatJsonPrimitive(value)}</span>
        {comma ? <span className="shrink-0 text-muted-foreground">,</span> : null}
      </JsonLine>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <JsonLine depth={depth}>
          {prefix}
          <span className="text-foreground">[]</span>
          {comma ? <span className="shrink-0 text-muted-foreground">,</span> : null}
        </JsonLine>
      );
    }

    return (
      <>
        <JsonLine depth={depth}>
          {prefix}
          <span className="text-muted-foreground">[</span>
        </JsonLine>
        {value.map((item, index) => (
          <JsonNode
            key={`${path}.${index}`}
            comma={index < value.length - 1}
            depth={depth + 1}
            expandedStrings={expandedStrings}
            onToggleString={onToggleString}
            path={buildPath(path, index)}
            value={item}
          />
        ))}
        <JsonLine depth={depth}>
          <span className="text-muted-foreground">]{comma ? "," : ""}</span>
        </JsonLine>
      </>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return (
      <JsonLine depth={depth}>
        {prefix}
        <span className="text-foreground">{"{}"}</span>
        {comma ? <span className="shrink-0 text-muted-foreground">,</span> : null}
      </JsonLine>
    );
  }

  return (
    <>
      <JsonLine depth={depth}>
        {prefix}
        <span className="text-muted-foreground">{"{"}</span>
      </JsonLine>
      {entries.map(([key, item], index) => (
        <JsonNode
          key={`${path}.${key}`}
          comma={index < entries.length - 1}
          depth={depth + 1}
          expandedStrings={expandedStrings}
          label={key}
          onToggleString={onToggleString}
          path={buildPath(path, key)}
          value={item}
        />
      ))}
      <JsonLine depth={depth}>
        <span className="text-muted-foreground">{"}"}{comma ? "," : ""}</span>
      </JsonLine>
    </>
  );
}

function StatusBadge({ log }: { log: AiCallLogEntry }) {
  return (
    <span
      className={[
        "inline-flex h-6 shrink-0 items-center rounded-[8px] border px-2 text-[11px] font-medium",
        log.ok
          ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
          : "border-destructive/25 bg-destructive/8 text-destructive",
      ].join(" ")}
    >
      {log.status || "ERR"}
    </span>
  );
}

// 错误信息中由 Rust 端附加的诊断段落格式（参见 provider_proxy.rs::format_decode_error_diagnostic）：
//   原始错误信息
//
//   [diagnostic: last N of M buffered bytes]
//   [utf-8 lossy]:
//   ...
//   [hex]:
//   ...
type DiagnosticSections = {
  summary: string;
  diagnosticHeader: string | null;
  utf8Lossy: string | null;
  hex: string | null;
};

function parseErrorDiagnostic(error: string): DiagnosticSections {
  if (!error) {
    return { summary: "", diagnosticHeader: null, utf8Lossy: null, hex: null };
  }
  const diagnosticIndex = error.indexOf("[diagnostic:");
  if (diagnosticIndex < 0) {
    return { summary: error.trim(), diagnosticHeader: null, utf8Lossy: null, hex: null };
  }
  const summary = error.slice(0, diagnosticIndex).trim();
  const utf8Start = error.indexOf("[utf-8 lossy]:", diagnosticIndex);
  const hexStart = error.indexOf("[hex]:", diagnosticIndex);
  let diagnosticHeader: string | null = null;
  let utf8Lossy: string | null = null;
  let hex: string | null = null;

  if (utf8Start >= 0) {
    diagnosticHeader = error.slice(diagnosticIndex, utf8Start).trim();
    const utf8BodyEnd = hexStart >= 0 ? hexStart : error.length;
    utf8Lossy = error.slice(utf8Start + "[utf-8 lossy]:".length, utf8BodyEnd).trim();
  } else {
    diagnosticHeader = error.slice(diagnosticIndex).trim();
  }
  if (hexStart >= 0) {
    hex = error.slice(hexStart + "[hex]:".length).trim();
  }
  return { summary, diagnosticHeader, utf8Lossy, hex };
}

type DiagnosticView = "utf8" | "hex";

function copyToClipboard(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast("已复制", { description: `${label}已写入剪贴板。` }),
    () => toast("复制失败", { description: "当前环境无法写入剪贴板。" }),
  );
}

function LogErrorPanel({ error }: { error: string }) {
  const sections = useMemo(() => parseErrorDiagnostic(error), [error]);
  const hasDiagnostic = sections.utf8Lossy != null || sections.hex != null;
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<DiagnosticView>(() => sections.utf8Lossy ? "utf8" : "hex");

  useEffect(() => {
    setView(sections.utf8Lossy ? "utf8" : "hex");
  }, [sections.utf8Lossy, sections.hex]);

  if (!error) return null;

  if (!hasDiagnostic) {
    // 没有结构化诊断 — 直接展示完整错误（保持兼容旧日志）
    return (
      <div className="mt-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-destructive">
          {sections.summary}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="复制错误信息"
          onClick={() => copyToClipboard(error, "错误信息")}
          className="shrink-0 rounded-xl"
        >
          <Clipboard className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const activeBody = view === "utf8" ? sections.utf8Lossy ?? "" : sections.hex ?? "";

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-destructive">
          {sections.summary}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="复制错误信息"
          onClick={() => copyToClipboard(error, "错误信息")}
          className="shrink-0 rounded-xl"
        >
          <Clipboard className="h-3.5 w-3.5" />
        </Button>
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex w-fit items-center gap-1 rounded-[6px] px-1 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-accent/35 hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>{expanded ? "收起诊断详情" : "查看诊断详情"}</span>
      </button>

      {expanded ? (
        <div className="overflow-hidden rounded-[8px] border border-border/45 bg-background dark:bg-background">
          <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/45 px-2 py-1">
            <div className="inline-flex items-center rounded-[8px] border border-border/45 bg-panel p-0.5">
              {([
                { key: "utf8" as const, label: "UTF-8 解码", disabled: sections.utf8Lossy == null },
                { key: "hex" as const, label: "16 进制", disabled: sections.hex == null },
              ]).map((item) => {
                const isActive = view === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={isActive}
                    disabled={item.disabled}
                    className={[
                      "h-7 rounded-[7px] px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                      isActive
                        ? "bg-background text-foreground shadow-[0_6px_14px_rgba(15,23,42,0.045)] dark:bg-panel-subtle dark:shadow-none"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    ].join(" ")}
                    onClick={() => setView(item.key)}
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
              aria-label="复制当前视图"
              onClick={() => copyToClipboard(activeBody, view === "utf8" ? "UTF-8 诊断" : "16 进制诊断")}
              disabled={!activeBody}
              className="rounded-xl"
            >
              <Clipboard className="h-3.5 w-3.5" />
            </Button>
          </div>
          {sections.diagnosticHeader ? (
            <p className="border-b border-border/45 px-3 py-2 text-[11px] text-muted-foreground">
              {sections.diagnosticHeader}
            </p>
          ) : null}
          <div className="max-h-72 overflow-auto px-3 py-2">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-foreground">
              {activeBody}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DebugPanelSection({
  actions,
  children,
  icon,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      <div className="flex min-h-10 shrink-0 flex-col gap-3 px-3 pt-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 text-muted-foreground">{icon}</span>
          <h3 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">{title}</h3>
        </div>
        {actions ? <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">{actions}</div> : null}
      </div>
      {children ? <div className="min-h-0 flex-1 px-3 pt-2 pb-3 sm:px-4 sm:pt-3 sm:pb-4">{children}</div> : null}
    </section>
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
  const payload = useMemo(() => parsePayloadJson(value), [value]);
  const [expandedStrings, setExpandedStrings] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedStrings(new Set());
  }, [activeView, value]);

  function toggleString(path: string) {
    setExpandedStrings((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <section className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-[8px] border border-border/45 bg-background dark:bg-background">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border/45 px-2">
        <div className="inline-flex min-w-0 items-center rounded-[8px] border border-border/45 bg-panel p-0.5">
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
                  "h-8 rounded-[7px] px-3 text-sm font-medium transition",
                  isActive
                    ? "bg-background text-foreground shadow-[0_6px_14px_rgba(15,23,42,0.045)] dark:bg-panel-subtle dark:shadow-none"
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
          className="rounded-xl"
        >
          <Clipboard className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {payload === null ? (
          <div className="px-2 py-3 text-xs leading-5 text-muted-foreground">空内容</div>
        ) : (
          <div className="py-1">
            {typeof payload === "string" ? (
              <JsonNode
                depth={0}
                expandedStrings={expandedStrings}
                onToggleString={toggleString}
                path="$"
                value={payload}
              />
            ) : (
              <JsonNode
                depth={0}
                expandedStrings={expandedStrings}
                onToggleString={toggleString}
                path="$"
                value={payload}
              />
            )}
          </div>
        )}
      </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <DebugPanelSection
          title="AI 调用日志"
          icon={<Bug className="h-4 w-4" />}
          actions={
            <>
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
            </>
          }
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-border/45 lg:flex-row">
            <aside className="max-h-[42%] min-h-[180px] shrink-0 overflow-y-auto border-b border-border/45 bg-background dark:bg-background lg:h-full lg:max-h-none lg:w-[320px] lg:border-r lg:border-b-0">
              <div className="flex h-10 items-center justify-between border-b border-border/45 px-3">
                <p className="text-xs font-medium text-muted-foreground">调用记录</p>
                <span className="text-xs text-muted-foreground">{logs.length}</span>
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
                          isActive ? "bg-accent/45 text-foreground" : "hover:bg-accent/35",
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

            <div className="min-h-0 flex-1 overflow-y-auto bg-card p-3 dark:bg-panel">
              {!selectedLog ? (
                <EmptyState errorMessage={errorMessage} status={status} />
              ) : (
                <div className="flex min-h-full flex-col gap-3">
                  <div className="rounded-[8px] border border-border/45 bg-background px-3 py-3 dark:bg-background">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge log={selectedLog} />
                      <span className="text-sm font-medium text-foreground">
                        {selectedLog.method} {formatEndpoint(selectedLog.url)}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatLogTime(selectedLog.createdAt)}</span>
                    </div>
                    {selectedLog.error ? <LogErrorPanel error={selectedLog.error} /> : null}
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
        </DebugPanelSection>
      </div>
    </section>
  );
}
