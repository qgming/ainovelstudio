import { renderLineWindow, splitTextLines } from "./workspaceHelpers";

function normalizeText(value: string, caseSensitive: boolean) {
  return caseSensitive ? value : value.toLocaleLowerCase();
}

function findNthIndex(
  lines: string[],
  predicate: (line: string) => boolean,
  occurrence: number,
) {
  let currentOccurrence = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!predicate(lines[index])) {
      continue;
    }
    currentOccurrence += 1;
    if (currentOccurrence === occurrence) {
      return index;
    }
  }

  return -1;
}

function normalizeHeadingQuery(heading: string) {
  return heading.trim().replace(/^#+\s*/, "");
}

function parseHeadingLine(line: string) {
  const match = line.match(/^(#{1,6})\s+(.*)$/);
  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

function renderReadWindow(
  path: string,
  lines: string[],
  startIndex: number,
  endIndex: number,
) {
  return renderLineWindow(path, startIndex + 1, lines.slice(startIndex, endIndex));
}

export function resolveAnchorWindow(params: {
  afterLines: number;
  anchor: string;
  beforeLines: number;
  caseSensitive: boolean;
  lines: string[];
  occurrence: number;
}) {
  const {
    afterLines,
    anchor,
    beforeLines,
    caseSensitive,
    lines,
    occurrence,
  } = params;
  const normalizedAnchor = normalizeText(anchor, caseSensitive);
  const anchorIndex = findNthIndex(
    lines,
    (line) => normalizeText(line, caseSensitive).includes(normalizedAnchor),
    occurrence,
  );

  if (anchorIndex < 0) {
    throw new Error(`未找到第 ${occurrence} 处包含指定 anchor 的文本。`);
  }

  return {
    endIndex: Math.min(anchorIndex + afterLines + 1, lines.length),
    startIndex: Math.max(anchorIndex - beforeLines, 0),
  };
}

export function resolveHeadingWindow(params: {
  heading: string;
  lines: string[];
  occurrence: number;
}) {
  const { heading, lines, occurrence } = params;
  const normalizedHeading = normalizeHeadingQuery(heading);
  const headingIndex = findNthIndex(lines, (line) => {
    const parsed = parseHeadingLine(line);
    return Boolean(parsed && parsed.text === normalizedHeading);
  }, occurrence);

  if (headingIndex < 0) {
    throw new Error(`未找到标题“${normalizedHeading}”。`);
  }

  const currentHeading = parseHeadingLine(lines[headingIndex]);
  if (!currentHeading) {
    throw new Error(`标题“${normalizedHeading}”解析失败。`);
  }

  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const parsed = parseHeadingLine(lines[index]);
    if (parsed && parsed.level <= currentHeading.level) {
      endIndex = index;
      break;
    }
  }

  return {
    endIndex,
    startIndex: headingIndex,
  };
}

export function readRangeAroundAnchor(params: {
  afterLines: number;
  anchor: string;
  beforeLines: number;
  caseSensitive: boolean;
  contents: string;
  occurrence: number;
  path: string;
}) {
  const {
    afterLines,
    anchor,
    beforeLines,
    caseSensitive,
    contents,
    occurrence,
    path,
  } = params;
  const lines = splitTextLines(contents);
  const { startIndex, endIndex } = resolveAnchorWindow({
    afterLines,
    anchor,
    beforeLines,
    caseSensitive,
    lines,
    occurrence,
  });
  return renderReadWindow(path, lines, startIndex, endIndex);
}

export function readRangeByHeading(params: {
  contents: string;
  heading: string;
  occurrence: number;
  path: string;
}) {
  const { contents, heading, occurrence, path } = params;
  const lines = splitTextLines(contents);
  const { startIndex, endIndex } = resolveHeadingWindow({
    heading,
    lines,
    occurrence,
  });
  return renderReadWindow(path, lines, startIndex, endIndex);
}
