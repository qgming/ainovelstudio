export type PromptSection = {
  body: string | null | undefined;
  title: string;
};

export const MANUAL_CONTEXT_FILE_CHAR_LIMIT = 6_000;
export const MANUAL_CONTEXT_TOTAL_CHAR_LIMIT = 12_000;

export function formatCurrentSystemDate(now = new Date()) {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

export function joinSections(sections: Array<string | null | undefined>) {
  return sections
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");
}

export function renderPromptSections(sections: PromptSection[]) {
  return sections
    .filter((section) => Boolean(section.body?.trim()))
    .map((section) =>
      [`## ${section.title}`, section.body?.trim()]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function createMiddleExcerpt(value: string, maxChars: number) {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return {
      omittedChars: 0,
      text: normalized,
      truncated: false,
    };
  }

  if (maxChars < 600) {
    return {
      omittedChars: normalized.length - maxChars,
      text: `${normalized.slice(0, maxChars).trimEnd()}…`,
      truncated: true,
    };
  }

  const headChars = Math.max(Math.floor(maxChars * 0.72), maxChars - 900);
  const tailChars = Math.max(maxChars - headChars, 320);
  return {
    omittedChars: normalized.length - maxChars,
    text: [
      normalized.slice(0, headChars).trimEnd(),
      "…（中间省略）…",
      normalized.slice(-tailChars).trimStart(),
    ].join("\n"),
    truncated: true,
  };
}
