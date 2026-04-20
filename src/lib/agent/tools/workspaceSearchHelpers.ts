import type { WorkspaceSearchMatch } from "../../bookWorkspace/types";
import { renderLineWindow, splitTextLines } from "./workspaceHelpers";

export type SearchMatchMode = "all_terms" | "any_term" | "phrase";
export type SearchSortBy = "path" | "relevance";

type SearchFilterOptions = {
  caseSensitive: boolean;
  matchMode: SearchMatchMode;
  query: string;
  wholeWord: boolean;
};

function normalizeText(value: string, caseSensitive: boolean) {
  return caseSensitive ? value : value.toLocaleLowerCase();
}

function getNameLikeValue(match: WorkspaceSearchMatch) {
  const parts = match.path.split("/");
  return parts[parts.length - 1] ?? match.path;
}

function shouldApplyWordBoundary(query: string) {
  return /[A-Za-z0-9_]/.test(query);
}

function isWordChar(char: string | undefined) {
  return Boolean(char && /[\p{L}\p{N}_]/u.test(char));
}

function findMatchRanges(
  source: string,
  query: string,
  caseSensitive: boolean,
): Array<{ end: number; start: number }> {
  const normalizedSource = normalizeText(source, caseSensitive);
  const normalizedQuery = normalizeText(query, caseSensitive);
  const ranges: Array<{ end: number; start: number }> = [];
  let searchIndex = 0;

  while (searchIndex <= normalizedSource.length - normalizedQuery.length) {
    const index = normalizedSource.indexOf(normalizedQuery, searchIndex);
    if (index < 0) {
      break;
    }
    ranges.push({
      end: index + normalizedQuery.length,
      start: index,
    });
    searchIndex = index + Math.max(normalizedQuery.length, 1);
  }

  return ranges;
}

function isWholeWordRange(
  source: string,
  range: { end: number; start: number },
  query: string,
) {
  if (!shouldApplyWordBoundary(query)) {
    return true;
  }

  return (
    !isWordChar(source[range.start - 1]) && !isWordChar(source[range.end])
  );
}

function getTargetText(match: WorkspaceSearchMatch) {
  return match.matchType === "content"
    ? match.lineText ?? ""
    : getNameLikeValue(match);
}

function tokenizeQuery(query: string) {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return tokens.length > 0 ? Array.from(new Set(tokens)) : [query.trim()];
}

function getStrongestRange(
  source: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
) {
  const ranges = findMatchRanges(source, query, caseSensitive).filter((range) =>
    wholeWord ? isWholeWordRange(source, range, query) : true,
  );

  return {
    allRanges: ranges,
    strongestRange: ranges[0],
  };
}

function getMatchBaseScore(match: WorkspaceSearchMatch) {
  if (match.matchType === "file_name") {
    return 240;
  }
  if (match.matchType === "directory_name") {
    return 180;
  }
  return 120;
}

function scoreSearchMatch(
  match: WorkspaceSearchMatch,
  source: string,
  query: string,
  caseSensitive: boolean,
  matchMode: SearchMatchMode,
  matchedTerms: number,
  rangeCount: number,
) {
  const normalizedSource = normalizeText(source.trim(), caseSensitive);
  const normalizedQuery = normalizeText(query.trim(), caseSensitive);
  const exactMatch =
    matchMode === "phrase" && normalizedSource === normalizedQuery;
  const startsWithQuery =
    matchMode === "phrase" && normalizedSource.startsWith(normalizedQuery);
  const rangeBonus = Math.min(rangeCount, 4) * 18;
  const exactBonus = exactMatch ? 120 : 0;
  const prefixBonus = !exactMatch && startsWithQuery ? 35 : 0;
  const multiTermBonus =
    matchMode === "phrase" ? 0 : matchedTerms * 20 + (matchMode === "all_terms" ? 25 : 0);
  const lineNumberPenalty = match.lineNumber ? Math.min(match.lineNumber, 40) : 0;

  return (
    getMatchBaseScore(match) +
    exactBonus +
    prefixBonus +
    multiTermBonus +
    rangeBonus -
    lineNumberPenalty
  );
}

export function normalizeSearchMatchMode(value: unknown): SearchMatchMode {
  return value === "all_terms" || value === "any_term" ? value : "phrase";
}

export function normalizeSearchSortBy(value: unknown): SearchSortBy {
  return value === "path" ? "path" : "relevance";
}

export function filterSearchMatch(
  match: WorkspaceSearchMatch,
  options: SearchFilterOptions,
) {
  const targetText = getTargetText(match);
  const terms =
    options.matchMode === "phrase"
      ? [options.query.trim()]
      : tokenizeQuery(options.query);
  const termMatches = terms.map((term) => ({
    term,
    ...getStrongestRange(
      targetText,
      term,
      options.caseSensitive,
      options.wholeWord,
    ),
  }));
  const matchedTerms = termMatches.filter((term) => term.strongestRange);
  if (
    (options.matchMode === "phrase" && matchedTerms.length === 0) ||
    (options.matchMode === "any_term" && matchedTerms.length === 0) ||
    (options.matchMode === "all_terms" && matchedTerms.length !== termMatches.length)
  ) {
    return null;
  }
  const strongestRange = [...matchedTerms]
    .map((term) => term.strongestRange)
    .filter((range): range is { end: number; start: number } => Boolean(range))
    .sort((left, right) => left.start - right.start || left.end - right.end)[0];

  if (!strongestRange) {
    return null;
  }

  const rangeCount = matchedTerms.reduce(
    (total, term) => total + term.allRanges.length,
    0,
  );

  return {
    ...match,
    matchEnd: strongestRange.end,
    matchStart: strongestRange.start,
    score: scoreSearchMatch(
      match,
      targetText,
      options.query,
      options.caseSensitive,
      options.matchMode,
      matchedTerms.length,
      rangeCount,
    ),
  };
}

export function buildSearchQueries(
  query: string,
  matchMode: SearchMatchMode,
) {
  return matchMode === "phrase" ? [query.trim()] : tokenizeQuery(query);
}

export function dedupeSearchMatches(matches: WorkspaceSearchMatch[]) {
  const unique = new Map<string, WorkspaceSearchMatch>();
  for (const match of matches) {
    const key = [
      match.matchType,
      match.path,
      match.lineNumber ?? "",
      match.lineText ?? "",
    ].join("::");
    if (!unique.has(key)) {
      unique.set(key, match);
    }
  }
  return Array.from(unique.values());
}

export function sortSearchMatches(
  matches: WorkspaceSearchMatch[],
  sortBy: SearchSortBy,
) {
  return [...matches].sort((left, right) => {
    if (sortBy === "path") {
      const pathCompare = left.path.localeCompare(right.path, "zh-CN");
      if (pathCompare !== 0) {
        return pathCompare;
      }
      return (left.lineNumber ?? 0) - (right.lineNumber ?? 0);
    }

    const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const pathCompare = left.path.localeCompare(right.path, "zh-CN");
    if (pathCompare !== 0) {
      return pathCompare;
    }

    return (left.lineNumber ?? 0) - (right.lineNumber ?? 0);
  });
}

export function limitSearchMatchesPerFile(
  matches: WorkspaceSearchMatch[],
  maxPerFile: number,
) {
  if (maxPerFile <= 0) {
    return matches;
  }

  const counts = new Map<string, number>();
  return matches.filter((match) => {
    const current = counts.get(match.path) ?? 0;
    if (current >= maxPerFile) {
      return false;
    }
    counts.set(match.path, current + 1);
    return true;
  });
}

export function addSearchContextWindow(
  match: WorkspaceSearchMatch,
  fileContents: string,
  beforeLines: number,
  afterLines: number,
) {
  if (match.matchType !== "content" || !match.lineNumber) {
    return match;
  }

  if (beforeLines <= 0 && afterLines <= 0) {
    return match;
  }

  const lines = splitTextLines(fileContents);
  const lineIndex = Math.max(match.lineNumber - 1, 0);
  const startIndex = Math.max(lineIndex - beforeLines, 0);
  const endIndex = Math.min(lineIndex + afterLines + 1, lines.length);

  return {
    ...match,
    contextEndLine: endIndex,
    contextStartLine: startIndex + 1,
    contextText: renderLineWindow(
      match.path,
      startIndex + 1,
      lines.slice(startIndex, endIndex),
    ),
  };
}
