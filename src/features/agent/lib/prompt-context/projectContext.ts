export const DEFAULT_PROJECT_README_PATH = ".project/README.md";
export const DEFAULT_PROJECT_MEMORY_DIR = ".project/memory";
const MEMORY_FILE_LIMIT = 50;
const RELATION_FILE_LIMIT = 12;

// 记忆文件 frontmatter 的 type 枚举(与 SKILL/模板约定一致)。
export type MemoryFileType =
  | "project"
  | "character"
  | "setting"
  | "plot"
  | "foreshadow"
  | "timeline"
  | "style"
  | "other";

export type ProjectContextPayload = {
  source: string;
  files: Array<{
    content?: string;
    description?: string;
    name: string;
    path: string;
    // 记忆清单条目专属:由文件 frontmatter 解析得到,供清单渲染。
    memoryType?: string;
    useWhen?: string;
    updated?: string;
  }>;
};

type ProjectTreeNode = {
  children?: ProjectTreeNode[];
  kind: "directory" | "file";
  name: string;
  path: string;
};

// 一条关联记录的精简形态:projectContext 只需要"对端路径 + 标签 + 备注"。
// 不直接依赖 books 的 WorkspaceRelation 类型,保持 agent 模块的解耦。
export type ProjectRelationRecord = {
  otherEntryPath: string;
  relationship: string;
  note?: string | null;
};

type LoadProjectContextInput = {
  activeFilePath?: string | null;
  readFile: (bookId: string, path: string) => Promise<string>;
  readRelations?: (
    bookId: string,
    entryPath: string,
  ) => Promise<ProjectRelationRecord[]>;
  readTree?: (bookId: string) => Promise<{
    children?: ProjectTreeNode[];
  }>;
  taskType?: string | null;
  // 解析用：书籍标识（UUID），作为 readFile/readTree/readRelations 的第一个参数。
  workspaceBookId: string | null;
};

function getBaseName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function findTreeNodeByPath(
  nodes: ProjectTreeNode[] | undefined,
  targetPath: string,
): ProjectTreeNode | null {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }

    const matched = findTreeNodeByPath(node.children, targetPath);
    if (matched) {
      return matched;
    }
  }

  return null;
}

type MemoryFrontmatter = {
  name?: string;
  description?: string;
  useWhen?: string;
  type?: string;
  updated?: string;
};

// 轻量解析记忆 md 顶部的 YAML frontmatter。只取 name/description/type/updated，
// 并从 description 的多行块里抽出 "Use when:" 一行单独呈现。
// 不引第三方 YAML 库——frontmatter 字段简单且受模板约束，手解析足够且更快。
export function parseMemoryFrontmatter(content: string): MemoryFrontmatter | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) {
    return null;
  }
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) {
    return null;
  }
  const block = normalized.slice(3, end).replace(/^\n/, "");
  const lines = block.split("\n");

  const result: MemoryFrontmatter = {};
  let currentKey: "description" | null = null;
  const descriptionLines: string[] = [];

  for (const rawLine of lines) {
    // 顶层 key 形如 `name:` `type:`（无前导空格）。带前导空格的视为块标量延续行。
    const keyMatch = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(rawLine);
    const isIndented = /^\s+\S/.test(rawLine);

    if (keyMatch && !isIndented) {
      const key = keyMatch[1].toLowerCase();
      const value = keyMatch[2].trim();
      if (key === "description") {
        currentKey = "description";
        if (value && value !== "|" && value !== ">") {
          descriptionLines.push(value);
        }
        continue;
      }
      currentKey = null;
      if (key === "name") result.name = stripQuotes(value);
      else if (key === "type") result.type = stripQuotes(value);
      else if (key === "updated") result.updated = stripQuotes(value);
      continue;
    }

    if (currentKey === "description" && isIndented) {
      descriptionLines.push(rawLine.trim());
    }
  }

  if (descriptionLines.length > 0) {
    const useWhenLine = descriptionLines.find((line) => /^use\s*when[:：]/i.test(line));
    if (useWhenLine) {
      result.useWhen = useWhenLine.replace(/^use\s*when[:：]\s*/i, "").trim();
    }
    const descOnly = descriptionLines.filter((line) => line !== useWhenLine);
    if (descOnly.length > 0) {
      result.description = descOnly.join(" ").trim();
    } else if (!result.description) {
      result.description = descriptionLines.join(" ").trim();
    }
  }

  return result;
}

function stripQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// 取文件首行的 markdown 标题作为无 frontmatter 时的兜底摘要。
function extractFirstHeading(content: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").trim();
    }
    if (trimmed) {
      return trimmed.slice(0, 60);
    }
  }
  return "";
}

// 记忆清单的稳定排序：index.md、project.md 这类入口文件优先，其余按文件名稳定排序。
// 不依赖 localeCompare 的 CJK/ASCII 跨区域行为，保证注入顺序在各环境一致。
const MEMORY_FILE_ORDER = ["index.md", "project.md"];

function memoryFileRank(path: string) {
  const index = MEMORY_FILE_ORDER.indexOf(getBaseName(path));
  return index >= 0 ? index : MEMORY_FILE_ORDER.length;
}

function collectMemoryFilePaths(root: { children?: ProjectTreeNode[] }) {
  const memoryNode = findTreeNodeByPath(root.children, DEFAULT_PROJECT_MEMORY_DIR);
  if (!memoryNode || memoryNode.kind !== "directory") {
    return [];
  }
  const children = memoryNode.children ?? [];
  return children
    .filter((node) => node.kind === "file" && node.path.toLowerCase().endsWith(".md"))
    .map((node) => node.path)
    .sort((left, right) => {
      const rankDiff = memoryFileRank(left) - memoryFileRank(right);
      return rankDiff !== 0 ? rankDiff : left.localeCompare(right);
    })
    .slice(0, MEMORY_FILE_LIMIT);
}

async function tryReadContextFile(
  readFile: LoadProjectContextInput["readFile"],
  workspaceBookId: string,
  path: string,
) {
  try {
    const content = await readFile(workspaceBookId, path);
    if (!content.trim()) return null;
    return { content, name: getBaseName(path), path };
  } catch {
    return null;
  }
}

function pushUniqueContextFile(
  files: ProjectContextPayload["files"],
  file: ProjectContextPayload["files"][number] | null,
) {
  if (!file || files.some((item) => item.path === file.path)) return;
  files.push(file);
}

// 扫描 .project/memory/ 下所有 md，解析 frontmatter，生成"记忆清单"条目（path-only，不带正文）。
// AI 看清单的 name/description/Use when 决定要不要 workspace_read 精读。
async function loadMemoryContextFiles(params: {
  files: ProjectContextPayload["files"];
  readTree: NonNullable<LoadProjectContextInput["readTree"]>;
  readFile: LoadProjectContextInput["readFile"];
  workspaceBookId: string;
}) {
  const tree = await params.readTree(params.workspaceBookId);
  const paths = collectMemoryFilePaths(tree);
  for (const path of paths) {
    let content = "";
    try {
      content = await params.readFile(params.workspaceBookId, path);
    } catch {
      continue;
    }
    if (!content.trim()) continue;

    const frontmatter = parseMemoryFrontmatter(content);
    const name = frontmatter?.name?.trim() || getBaseName(path);
    const description =
      frontmatter?.description?.trim() || extractFirstHeading(content) || undefined;

    pushUniqueContextFile(params.files, {
      name,
      path,
      description,
      memoryType: frontmatter?.type?.trim() || undefined,
      useWhen: frontmatter?.useWhen?.trim() || undefined,
      updated: frontmatter?.updated?.trim() || undefined,
    });
  }
}

// 把 active file 的关联文件追加为 path-only 描述型条目,description 形如
// "[关联文件 · 出场人物] 本章主角",AI 看到提示后可按需 read 对端内容。
async function loadRelationContextFiles(params: {
  activeFilePath: string;
  files: ProjectContextPayload["files"];
  readRelations: NonNullable<LoadProjectContextInput["readRelations"]>;
  workspaceBookId: string;
}) {
  const relations = await params.readRelations(
    params.workspaceBookId,
    params.activeFilePath,
  );
  relations.slice(0, RELATION_FILE_LIMIT).forEach((relation) => {
    const label = relation.relationship?.trim() || "未标注关系";
    const noteSuffix = relation.note && relation.note.trim()
      ? ` ${relation.note.trim()}`
      : "";
    pushUniqueContextFile(params.files, {
      description: `[关联文件 · ${label}]${noteSuffix}`,
      name: getBaseName(relation.otherEntryPath),
      path: relation.otherEntryPath,
    });
  });
}

export async function loadProjectContext({
  activeFilePath,
  readFile,
  readRelations,
  readTree,
  workspaceBookId,
}: LoadProjectContextInput): Promise<ProjectContextPayload | null> {
  if (!workspaceBookId) {
    return null;
  }

  const files: ProjectContextPayload["files"] = [];

  // ① README:唯一项目入口,全文注入。
  pushUniqueContextFile(
    files,
    await tryReadContextFile(readFile, workspaceBookId, DEFAULT_PROJECT_README_PATH),
  );

  // ② 记忆清单:扫描 memory/ 解析 frontmatter,path-only 注入(不带正文)。
  if (readTree) {
    try {
      await loadMemoryContextFiles({
        files,
        readTree,
        readFile,
        workspaceBookId,
      });
    } catch {
      // 记忆扫描失败不阻塞主流程,保留 README 等默认上下文。
    }
  }

  // ③ active file 的关联文件:path-only 注入(现有机制)。
  if (activeFilePath && readRelations) {
    try {
      await loadRelationContextFiles({
        activeFilePath,
        files,
        readRelations,
        workspaceBookId,
      });
    } catch {
      // 关联拉取失败不阻塞主流程,保留其它默认上下文。
    }
  }

  if (files.length === 0) {
    return null;
  }

  return {
    source: "项目默认上下文",
    files,
  };
}
