import { SendHorizontal, Square } from "lucide-react";
import type { KeyboardEvent } from "react";
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
  contextTags: _contextTags,
  input,
  onInputChange,
  onStop,
  onSubmit,
  runStatus,
}: AgentComposerProps) {
  const isRunning = runStatus === "running";

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!isRunning && input.trim()) {
      onSubmit();
    }
  };

  return (
    <div className="border-t border-[#e2e8f0] bg-[#f7f7f8] px-3 py-3 dark:border-[#20242b] dark:bg-[#111214]">
      <div className="rounded-[10px] border border-[#dce3ee] bg-white px-3 py-2 dark:border-[#2a3039] dark:bg-[#12161c]">
        <textarea
          aria-label="Agent 输入框"
          className="min-h-[64px] w-full resize-none border-none bg-transparent text-sm leading-6 text-[#1f2937] outline-none placeholder:text-[#8c97a8] dark:text-[#eef2f7] dark:placeholder:text-[#5f6b7d]"
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="让 agent 读取当前章节、调用技能和工具完成创作任务..."
          value={input}
        />
        <div className="mt-2 flex items-center justify-end gap-3">
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
