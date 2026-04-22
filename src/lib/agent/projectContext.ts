export const DEFAULT_PROJECT_AGENT_PATH = ".project/AGENTS.md";
export const DEFAULT_PROJECT_STATUS_PATH = ".project/status";
const STATUS_FILE_LIMIT = 6;
const STATUS_FILE_PRIORITIES = [
  "latest-plot.json",
  "character-state.json",
  "system-state.json",
  "continuity-index.json",
  "project-state.json",
  "factory-index.json",
] as const;

export type ProjectContextPayload = {
  source: string;
  files: Array<{
    content: string;
    name: string;
    path: string;
  }>;
};

type ProjectTreeNode = {
  children?: ProjectTreeNode[];
  kind: "directory" | "file";
  name: string;
  path: string;
};

type LoadProjectContextInput = {
  readFile: (rootPath: string, path: string) => Promise<string>;
  readTree?: (rootPath: string) => Promise<{
    children?: ProjectTreeNode[];
  }>;
  workspaceRootPath: string | null;
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

function getStatusFilePriority(path: string) {
  const index = STATUS_FILE_PRIORITIES.indexOf(getBaseName(path) as (typeof STATUS_FILE_PRIORITIES)[number]);
  return index >= 0 ? index : STATUS_FILE_PRIORITIES.length;
}

function collectStatusJsonPaths(
  root: {
    children?: ProjectTreeNode[];
  },
) {
  const statusNode = findTreeNodeByPath(root.children, DEFAULT_PROJECT_STATUS_PATH);
  if (!statusNode || statusNode.kind !== "directory") {
    return [];
  }

  const statusChildren = statusNode.children ?? [];

  return statusChildren
    .filter((node) => node.kind === "file" && node.path.toLowerCase().endsWith(".json"))
    .sort((left, right) =>
      getStatusFilePriority(left.path) - getStatusFilePriority(right.path)
      || left.path.localeCompare(right.path),
    )
    .slice(0, STATUS_FILE_LIMIT)
    .map((node) => node.path);
}

export async function loadProjectContext({
  readFile,
  readTree,
  workspaceRootPath,
}: LoadProjectContextInput): Promise<ProjectContextPayload | null> {
  if (!workspaceRootPath) {
    return null;
  }

  const files: ProjectContextPayload["files"] = [];

  try {
    const content = await readFile(workspaceRootPath, DEFAULT_PROJECT_AGENT_PATH);
    if (!content.trim()) {
      return null;
    }

    files.push({
      content,
      name: getBaseName(DEFAULT_PROJECT_AGENT_PATH),
      path: DEFAULT_PROJECT_AGENT_PATH,
    });
  } catch {
    // ignore missing project agent file so status JSON 仍可作为默认真值层注入
  }

  if (readTree) {
    try {
      const tree = await readTree(workspaceRootPath);
      const statusPaths = collectStatusJsonPaths(tree);
      const statusContents = await Promise.all(
        statusPaths.map(async (path) => ({
          content: await readFile(workspaceRootPath, path),
          name: getBaseName(path),
          path,
        })),
      );
      files.push(
        ...statusContents.filter((file) => file.content.trim()),
      );
    } catch {
      // ignore status preload failures and keep other default context
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
