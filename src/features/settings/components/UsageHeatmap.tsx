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
    <div className="px-4 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5">
      <div>
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
                  className={`aspect-square w-full min-w-0 rounded-[3px] border border-border/55 transition-colors ${getLevelClass(day.level)}`}
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
