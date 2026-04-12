type HeatmapDay = {
  dateKey: string;
  dayLabel: string;
  requestCount: number;
  tokenTotal: number;
  level: 0 | 1 | 2 | 3 | 4;
};

function getLevelClass(level: HeatmapDay["level"]) {
  if (level === 0) {
    return "bg-[#f8fafc] dark:bg-[#0f1318]";
  }
  if (level === 1) {
    return "bg-[#dbeafe] dark:bg-[#102335]";
  }
  if (level === 2) {
    return "bg-[#93c5fd] dark:bg-[#163a58]";
  }
  if (level === 3) {
    return "bg-[#60a5fa] dark:bg-[#1f5b87]";
  }
  return "bg-[#2563eb] dark:bg-[#2d7eea]";
}

export function UsageHeatmap({
  formatMetric,
  weeks,
}: {
  formatMetric: (value: number) => string;
  weeks: HeatmapDay[][];
}) {
  const columnCount = Math.max(weeks.length, 1);

  return (
    <div className="border-b border-[#e2e8f0] px-4 py-4 dark:border-[#20242b]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#0f172a] dark:text-zinc-100">热力图</p>
          <p className="mt-1 text-xs text-[#94a3b8] dark:text-[#64748b]">按天汇总请求次数，颜色越深表示请求越密集。</p>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-[#94a3b8] dark:text-[#64748b]">
          <span>低</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={`h-2.5 w-2.5 border border-[#d8dee8] dark:border-[#2a3038] ${getLevelClass(level as HeatmapDay["level"])}`}
            />
          ))}
          <span>高</span>
        </div>
      </div>
      <div className="mt-4">
        <div
          className="grid w-full gap-[4px]"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {weeks.map((week, weekIndex) => (
            <div key={`week-${weekIndex}`} className="grid grid-rows-10 gap-[4px]">
              {week.map((day, dayIndex) => (
                <div
                  key={day.dateKey}
                  title={`${day.dayLabel} · ${day.requestCount} 次请求 · ${formatMetric(day.tokenTotal)} tokens`}
                  className={`aspect-square w-full min-w-0 border border-[#d8dee8] transition-colors dark:border-[#2a3038] ${getLevelClass(day.level)}`}
                  data-is-today={weekIndex === weeks.length - 1 && dayIndex === week.length - 1 ? "true" : "false"}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
