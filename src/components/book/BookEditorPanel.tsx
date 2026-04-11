import { useEffect, useState } from "react";
import { Copy, ReceiptText, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[#f7f7f8] px-8 py-10 dark:bg-[#111214]">
        <div className="max-w-md text-center">
          <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#111827] dark:text-[#f3f4f6]">
            从左侧打开一个文件。
          </h2>
          <p className="mt-4 text-base leading-7 text-[#6b7280] dark:text-[#9aa4b2]">
            章节、大纲和设定文件会在这里直接编辑，并保存回原文件。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-3 py-1 dark:border-[#20242b]">
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
          {activeFileName}
        </h2>
        <div className="flex items-center gap-1.5">
          {isDirty ? (
            <span className="px-2 py-1 text-xs font-medium text-[#b45309] dark:text-[#f7c680]">
              未保存
            </span>
          ) : null}
          {supportsMarkdownPreview ? (
            <button
              type="button"
              aria-label={isMarkdownPreview ? "切换到文本编辑" : "切换到 Markdown 预览"}
              aria-pressed={isMarkdownPreview}
              disabled={busy}
              onClick={() => setIsMarkdownPreview((current) => !current)}
              className={[
                "flex h-8 w-8 items-center justify-center rounded-[8px] p-0 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
                isMarkdownPreview
                  ? "bg-[#e8f1ff] text-[#0b84e7] hover:bg-[#dce9ff] dark:bg-[#162131] dark:text-[#7cc4ff] dark:hover:bg-[#1b2a3d]"
                  : "text-[#111827] hover:bg-[#edf1f6] dark:text-zinc-300 dark:hover:bg-[#1a1c21]",
              ].join(" ")}
            >
              <ReceiptText className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="复制当前内容"
            disabled={busy}
            onClick={() => void copyContent()}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={busy ? "保存中" : "保存当前文件"}
            disabled={busy}
            onClick={onSave}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isMarkdownPreview ? (
          <div className="h-full overflow-y-auto px-6 py-5">
            {content.trim() ? (
              <div className="book-markdown mx-auto max-w-4xl text-[15px] leading-7 text-[#111827] dark:text-[#f3f4f6]">
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
                      <blockquote className="mb-4 border-l-2 border-[#bfdbfe] pl-4 text-[#475569] dark:border-[#31506e] dark:text-[#cbd5e1] last:mb-0">
                        {children}
                      </blockquote>
                    ),
                    code: ({ children, className, ...props }) => (
                      <code
                        {...props}
                        className={`rounded bg-[#eef2f7] px-1.5 py-0.5 font-mono text-[0.92em] text-[#0f172a] dark:bg-[#1b2027] dark:text-[#e2e8f0] ${className ?? ""}`.trim()}
                      >
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="mb-4 overflow-x-auto rounded-[12px] bg-[#f3f6fb] px-4 py-3 font-mono text-[0.92em] text-[#0f172a] dark:bg-[#1b2027] dark:text-[#e2e8f0] last:mb-0">
                        {children}
                      </pre>
                    ),
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#0b84e7] underline underline-offset-2 hover:text-[#086fc0] dark:text-[#7cc4ff] dark:hover:text-[#a6d8ff]"
                      >
                        {children}
                      </a>
                    ),
                    hr: () => <hr className="my-5 border-[#e2e8f0] dark:border-[#20242b]" />,
                    table: ({ children }) => (
                      <div className="mb-4 overflow-x-auto last:mb-0">
                        <table className="w-full border-collapse text-left text-inherit">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border border-[#d8e0ea] bg-[#f8fafc] px-3 py-2 font-semibold dark:border-[#26303b] dark:bg-[#171b21]">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-[#d8e0ea] px-3 py-2 align-top dark:border-[#26303b]">
                        {children}
                      </td>
                    ),
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-sm leading-6 text-[#64748b] dark:text-[#94a3b8]">
                当前 Markdown 内容为空，切回文本模式后即可直接开始编辑。
              </div>
            )}
          </div>
        ) : (
          <textarea
            aria-label="文件编辑器"
            value={content}
            onChange={(event) => onChange(event.target.value)}
            className="h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-[15px] leading-8 text-[#111827] outline-none dark:text-[#f3f4f6]"
            spellCheck={false}
          />
        )}
      </div>
    </section>
  );
}
