import { SendHorizontal, Square } from "lucide-react";
import type { AgentRunStatus } from "../../lib/agent/types";

type AgentComposerProps = {
  contextTags: string[];
  input: string;
  onInputChange: (value: string) => void;
  onStop: () => void;
  onSubmit: () => void;
  runStatus: AgentRunStatus;
};

export function AgentComposer({
  contextTags,
  input,
  onInputChange,
  onStop,
  onSubmit,
  runStatus,
}: AgentComposerProps) {
  const isRunning = runStatus === "running";

  return (
    <div className="border-t border-[#e2e8f0] bg-[#f7f7f8] px-3 py-3 dark:border-[#20242b] dark:bg-[#111214]">
      <div className="mb-2 flex flex-wrap gap-2">
        {contextTags.map((tag) => (
          <span
            key={tag}
            className="rounded-[999px] border border-[#d8dee8] bg-white px-2 py-0.5 text-[11px] font-medium text-[#526074] dark:border-[#2e353f] dark:bg-[#171b22] dark:text-[#95a1b3]"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="rounded-[10px] border border-[#dce3ee] bg-white p-3 dark:border-[#2a3039] dark:bg-[#12161c]">
        <textarea
          aria-label="Agent 输入框"
          className="min-h-[88px] w-full resize-none border-none bg-transparent text-sm leading-6 text-[#1f2937] outline-none placeholder:text-[#8c97a8] dark:text-[#eef2f7] dark:placeholder:text-[#5f6b7d]"
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="让 agent 读取当前章节、调用技能和工具完成创作任务..."
          value={input}
        />
        <div className="mt-3 flex items-center justify-end gap-3">
          <button
            type="button"
            aria-label={isRunning ? "停止输出" : "发送消息"}
            onClick={isRunning ? onStop : onSubmit}
            disabled={!isRunning && !input.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#111827] text-white transition hover:bg-[#0b1220] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
          >
            {isRunning ? <Square className="h-4 w-4 fill-current" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
