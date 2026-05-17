export const MAX_TOOL_OUTPUT_SUMMARY_CHARS = 6_000;

export type TruncatedText = {
  originalChars: number;
  text: string;
  truncated: boolean;
};

export function truncateTextWithMeta(value: string, maxChars: number): TruncatedText {
  const originalChars = value.length;
  if (value.length <= maxChars) {
    return { originalChars, text: value, truncated: false };
  }

  return {
    originalChars,
    text: `${value.slice(0, maxChars).trimEnd()}\n\n[内容已截断：原始 ${originalChars} 字符，仅保留前 ${maxChars} 字符。]`,
    truncated: true,
  };
}
