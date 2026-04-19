import { useEffect, useState } from "react";
import { Copy, ReceiptText, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

type BookEditorPanelProps = {
  activeFileName: string | null;
  busy?: boolean;
  content: string;
  isDirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};
export function BookEditorPanel({
  activeFileName,
  busy = false,
  content,
  isDirty,
  onChange,
  onSave,
}: BookEditorPanelProps) {
  const supportsMarkdownPreview = activeFileName?.toLowerCase().endsWith(".md") ?? false;
  const [isMarkdownPreview, setIsMarkdownPreview] = useState(false);

  useEffect(() => {
    setIsMarkdownPreview(false);
  }, [activeFileName]);

  const copyContent = async () => {
    await navigator.clipboard.writeText(content);
  };

  if (!activeFileName) {
    return (
      <section className="flex h-full min-h-0 flex-1 items-center justify-center bg-panel px-8 py-10">
        <div className="max-w-md text-center">
          <h2 className="editor-empty-state-title">
            从左侧打开一个文件。
          </h2>
          <p className="editor-empty-state-copy text-base">
            章节、大纲和设定文件会在这里直接编辑，并保存回原文件。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-panel">
      <header className="editor-panel-header">
        <h2 className="editor-panel-title text-[13px]">
          {activeFileName}
        </h2>
        <div className="editor-toolbar">
          {isDirty ? (
            <span className="editor-status-chip" data-tone="warning">未保存</span>
          ) : null}
          {supportsMarkdownPreview ? (
            <Button
              type="button"
              aria-label={isMarkdownPreview ? "切换到文本编辑" : "切换到 Markdown 预览"}
              aria-pressed={isMarkdownPreview}
              disabled={busy}
              onClick={() => setIsMarkdownPreview((current) => !current)}
              variant={isMarkdownPreview ? "secondary" : "ghost"}
              size="icon-sm"
              className="text-muted-foreground"
            >
              <ReceiptText className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            aria-label="复制当前内容"
            disabled={busy}
            onClick={() => void copyContent()}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            aria-label={busy ? "保存中" : "保存当前文件"}
            disabled={busy}
            onClick={onSave}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
          >
            <Save className="h-4 w-4" />
          </Button>
        </div>
      </header>
        <div className="min-h-0 flex-1 overflow-hidden">
        {isMarkdownPreview ? (
          <div className="h-full overflow-y-auto bg-panel px-6 py-5">
            {content.trim() ? (
              <div className="book-markdown mx-auto max-w-4xl text-[14px] leading-7 text-foreground">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mb-4 text-3xl font-semibold tracking-[-0.04em] text-inherit">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mb-3 mt-8 text-2xl font-semibold tracking-[-0.03em] text-inherit first:mt-0">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mb-3 mt-6 text-xl font-semibold text-inherit first:mt-0">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => <p className="mb-4 text-inherit last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="mb-4 list-disc pl-6 last:mb-0">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-4 list-decimal pl-6 last:mb-0">{children}</ol>,
                    li: ({ children }) => <li className="mb-1.5 text-inherit last:mb-0">{children}</li>,
                    blockquote: ({ children }) => (
                      <blockquote className="mb-4 border-l-2 border-primary/35 pl-4 text-muted-foreground last:mb-0">
                        {children}
                      </blockquote>
                    ),
                    code: ({ children, className, ...props }) => (
                      <code
                        {...props}
                        className={`rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.92em] text-foreground ${className ?? ""}`.trim()}
                      >
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="mb-4 overflow-x-auto rounded-md border border-border bg-panel-subtle px-4 py-3 font-mono text-[0.92em] text-foreground last:mb-0">
                        {children}
                      </pre>
                    ),
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2 hover:text-primary/80"
                      >
                        {children}
                      </a>
                    ),
                    hr: () => <hr className="my-5 border-border" />,
                    table: ({ children }) => (
                      <div className="mb-4 overflow-x-auto last:mb-0">
                        <table className="w-full border-collapse text-left text-inherit">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border border-border bg-panel-subtle px-3 py-2 font-semibold">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-border px-3 py-2 align-top">
                        {children}
                      </td>
                    ),
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-sm leading-6 text-muted-foreground">
                当前 Markdown 内容为空，切回文本模式后即可直接开始编辑。
              </div>
            )}
          </div>
        ) : (
          <textarea
            aria-label="文件编辑器"
            value={content}
            onChange={(event) => onChange(event.target.value)}
            className="editor-textarea h-full px-4 py-4 text-[15px] leading-8"
            spellCheck={false}
          />
        )}
      </div>
    </section>
  );
}
