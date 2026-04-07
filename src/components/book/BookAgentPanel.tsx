type BookAgentPanelProps = {
  width: number;
};

export function BookAgentPanel({ width }: BookAgentPanelProps) {
  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-2 dark:border-[#20242b]">
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
          Agent
        </h2>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10 text-center">
        <div className="max-w-[220px]">
          <p className="text-sm font-medium text-[#64748b] dark:text-[#94a3b8]">
            Agent 面板预留中
          </p>
          <p className="mt-3 text-sm leading-6 text-[#94a3b8] dark:text-[#64748b]">
            这里后续可以放对话、任务和创作辅助能力。
          </p>
        </div>
      </div>
    </aside>
  );
}
