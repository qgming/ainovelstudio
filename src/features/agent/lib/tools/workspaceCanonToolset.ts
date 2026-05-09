import {
  readWorkspaceTextFile,
  searchWorkspaceContent,
} from "@features/books/api/bookWorkspaceApi";
import type { WorkspaceSearchMatch } from "@features/books/types";
import type { AgentTool } from "../runtime";
import {
  asPositiveInt,
  ensureString,
  getAbortContext,
  ok,
  type WorkspaceToolContext,
} from "./shared";

const CANON_QUERY_PATHS = [
  ".project/canon",
  ".project/status",
  ".project/style",
  ".project/chapters",
  ".project/MEMORY",
];

function normalizeKind(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "canon";
}

function isCanonPath(path: string, requestedKind: string) {
  const normalized = path.replace(/\\/g, "/");
  if (requestedKind === "status") return normalized.startsWith(".project/status/");
  if (requestedKind === "style") return normalized.startsWith(".project/style/");
  if (requestedKind === "chapter") return normalized.startsWith(".project/chapters/");
  if (requestedKind === "memory") return normalized.startsWith(".project/MEMORY/");
  return CANON_QUERY_PATHS.some((prefix) => normalized.startsWith(`${prefix}/`));
}

function formatCanonMatch(match: WorkspaceSearchMatch) {
  if (match.matchType === "content") {
    return {
      lineNumber: match.lineNumber,
      lineText: match.lineText,
      path: match.path,
      type: "content",
    };
  }
  return {
    path: match.path,
    type: match.matchType,
  };
}

function buildSummary(query: string, matches: ReturnType<typeof formatCanonMatch>[]) {
  if (matches.length === 0) {
    return `未在 canon / status / style / chapters 中找到“${query}”。`;
  }
  const lines = matches.map((match) => {
    if (match.type === "content") {
      return `- ${match.path}:${match.lineNumber} ${match.lineText ?? ""}`.trimEnd();
    }
    return `- ${match.path}`;
  });
  return [`找到 ${matches.length} 条与“${query}”相关的 canon 线索：`, ...lines].join("\n");
}

async function readSeedFiles(rootPath: string, query: string, context: ReturnType<typeof getAbortContext>) {
  const seedPaths = [
    ".project/canon/README.md",
    ".project/style/voice.md",
    ".project/chapters/README.md",
  ];
  const files = await Promise.all(
    seedPaths.map(async (path) => {
      try {
        return { content: await readWorkspaceTextFile(rootPath, path, context), path };
      } catch {
        return null;
      }
    }),
  );
  return files
    .filter((file): file is { content: string; path: string } => Boolean(file))
    .filter((file) => file.content.includes(query))
    .map((file) => ({
      lineText: file.content.split("\n").find((line) => line.includes(query)) ?? "",
      matchType: "content" as const,
      path: file.path,
    }));
}

export function createWorkspaceCanonTools({
  rootPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    canon_query: {
      description: "按人物、地点、伏笔、能力边界或章节线索查询长篇 canon 事实源",
      execute: async (input, context) => {
        const abortContext = getAbortContext(context);
        const query = ensureString(input.query, "canon_query.query");
        const kind = normalizeKind(input.kind);
        const limit = Math.min(asPositiveInt(input.limit, 12), 30);
        const rawMatches = await searchWorkspaceContent(rootPath, query, limit * 4, abortContext);
        const matches = rawMatches
          .filter((match) => isCanonPath(match.path, kind))
          .slice(0, limit);
        const fallback = matches.length > 0
          ? []
          : await readSeedFiles(rootPath, query, abortContext);
        const data = [...matches, ...fallback].slice(0, limit).map(formatCanonMatch);
        return ok(buildSummary(query, data), { kind, matches: data, query });
      },
    },
  };
}
