import type { ContextManifest, ContextManifestPolicy } from "./longformTypes";

export const DEFAULT_PROJECT_AGENT_PATH = ".project/AGENTS.md";
export const DEFAULT_PROJECT_CONTEXT_MANIFEST_PATH = ".project/context-manifest.json";
export const DEFAULT_PROJECT_README_PATH = ".project/README.md";
export const DEFAULT_PROJECT_STATUS_PATH = ".project/status";
const MANIFEST_FILE_LIMIT = 12;
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
    content?: string;
    description?: string;
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
  activeFilePath?: string | null;
  readFile: (rootPath: string, path: string) => Promise<string>;
  readTree?: (rootPath: string) => Promise<{
    children?: ProjectTreeNode[];
  }>;
  taskType?: string | null;
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
  const index = STATUS_FILE_PRIORITIES.indexOf(
    getBaseName(path) as (typeof STATUS_FILE_PRIORITIES)[number],
  );
  return index >= 0 ? index : STATUS_FILE_PRIORITIES.length;
}

function getJsonContextDescription(path: string) {
  const name = getBaseName(path);
  const descriptions: Record<string, string> = {
    "character-state.json": "人物状态真值层，通常记录角色当前位置、关系、动机、伤势、能力、秘密与阶段性变化。",
    "continuity-index.json": "连续性索引，通常记录伏笔、承接点、未解决事项、时间线和容易前后矛盾的事实。",
    "factory-index.json": "生产索引，通常记录章节生产、资料生成、批量任务或工厂化流程的入口信息。",
    "latest-plot.json": "最新剧情状态，通常记录当前章节、主线目标、近期事件、下一步推进方向和关键冲突。",
    "project-state.json": "项目级状态，通常记录整本书的当前阶段、整体目标、运行状态和重要约束。",
    "system-state.json": "系统/世界状态，通常记录世界观规则、组织局势、能力体系、资源变化和外部环境。",
  };

  if (path === DEFAULT_PROJECT_CONTEXT_MANIFEST_PATH) {
    return "上下文策略文件，程序已读取用于决定默认上下文；需要查看策略细节时再按路径 read。";
  }

  return descriptions[name] ?? "JSON 结构化资料文件，默认只注入路径；需要字段细节时再按路径 read。";
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
    .filter((node) =>
      node.kind === "file" && node.path.toLowerCase().endsWith(".json")
    )
    .sort((left, right) =>
      getStatusFilePriority(left.path) - getStatusFilePriority(right.path)
      || left.path.localeCompare(right.path),
    )
    .slice(0, STATUS_FILE_LIMIT)
    .map((node) => node.path);
}

function normalizePathList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeManifestPolicy(value: unknown): ContextManifestPolicy | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const taskType = typeof candidate.taskType === "string" ? candidate.taskType.trim() : "";
  if (!taskType) return null;
  return {
    alwaysInclude: normalizePathList(candidate.alwaysInclude),
    charBudget: typeof candidate.charBudget === "number" ? candidate.charBudget : 0,
    fullReadTriggers: normalizePathList(candidate.fullReadTriggers),
    includeIfActive: normalizePathList(candidate.includeIfActive),
    priority: typeof candidate.priority === "number" ? candidate.priority : 0,
    summaryFirst: normalizePathList(candidate.summaryFirst),
    taskType,
  };
}

function parseContextManifest(content: string): ContextManifest | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const policies = Array.isArray(parsed.policies)
      ? parsed.policies
        .map(normalizeManifestPolicy)
        .filter((item): item is ContextManifestPolicy => item !== null)
      : [];
    return {
      bookName: typeof parsed.bookName === "string" ? parsed.bookName : undefined,
      policies,
      version: typeof parsed.version === "number" ? parsed.version : 1,
    };
  } catch {
    return null;
  }
}

function chooseManifestPolicies(
  manifest: ContextManifest | null,
  taskType?: string | null,
) {
  if (!manifest?.policies.length) return [];
  const normalizedTaskType = taskType?.trim();
  const matched = normalizedTaskType
    ? manifest.policies.filter((policy) => policy.taskType === normalizedTaskType)
    : [];
  return (matched.length ? matched : manifest.policies)
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 2);
}

function collectManifestPaths(
  policies: ContextManifestPolicy[],
  activeFilePath?: string | null,
) {
  const paths = new Set<string>();
  policies.forEach((policy) => {
    policy.alwaysInclude.forEach((path) => paths.add(path));
    policy.summaryFirst.forEach((path) => paths.add(path));
    if (activeFilePath) policy.includeIfActive.forEach((path) => paths.add(path));
  });
  return Array.from(paths).slice(0, MANIFEST_FILE_LIMIT);
}

async function tryReadContextFile(
  readFile: LoadProjectContextInput["readFile"],
  workspaceRootPath: string,
  path: string,
) {
  try {
    const content = await readFile(workspaceRootPath, path);
    if (!content.trim()) return null;
    return { content, name: getBaseName(path), path };
  } catch {
    return null;
  }
}

function createPathOnlyContextFile(path: string): ProjectContextPayload["files"][number] {
  const isJson = path.toLowerCase().endsWith(".json");
  return {
    description: isJson ? getJsonContextDescription(path) : undefined,
    name: getBaseName(path),
    path,
  };
}

function pushUniqueContextFile(
  files: ProjectContextPayload["files"],
  file: ProjectContextPayload["files"][number] | null,
) {
  if (!file || files.some((item) => item.path === file.path)) return;
  files.push(file);
}

async function loadManifestContextFiles(params: {
  activeFilePath?: string | null;
  files: ProjectContextPayload["files"];
  manifest: ContextManifest | null;
  readFile: LoadProjectContextInput["readFile"];
  taskType?: string | null;
  workspaceRootPath: string;
}) {
  const policyPaths = collectManifestPaths(
    chooseManifestPolicies(params.manifest, params.taskType),
    params.activeFilePath,
  );
  for (const path of policyPaths) {
    pushUniqueContextFile(
      params.files,
      await tryReadContextFile(params.readFile, params.workspaceRootPath, path),
    );
  }
}

async function loadStatusContextFiles(params: {
  files: ProjectContextPayload["files"];
  readTree: NonNullable<LoadProjectContextInput["readTree"]>;
  workspaceRootPath: string;
}) {
  const tree = await params.readTree(params.workspaceRootPath);
  const statusPaths = collectStatusJsonPaths(tree);
  statusPaths.forEach((path) =>
    pushUniqueContextFile(params.files, createPathOnlyContextFile(path))
  );
}

export async function loadProjectContext({
  activeFilePath,
  readFile,
  readTree,
  taskType,
  workspaceRootPath,
}: LoadProjectContextInput): Promise<ProjectContextPayload | null> {
  if (!workspaceRootPath) {
    return null;
  }

  const files: ProjectContextPayload["files"] = [];
  let manifest: ContextManifest | null = null;

  pushUniqueContextFile(
    files,
    await tryReadContextFile(readFile, workspaceRootPath, DEFAULT_PROJECT_AGENT_PATH),
  );
  pushUniqueContextFile(
    files,
    await tryReadContextFile(readFile, workspaceRootPath, DEFAULT_PROJECT_README_PATH),
  );

  const manifestFile = await tryReadContextFile(
    readFile,
    workspaceRootPath,
    DEFAULT_PROJECT_CONTEXT_MANIFEST_PATH,
  );
  if (manifestFile) {
    manifest = parseContextManifest(manifestFile.content);
    pushUniqueContextFile(files, createPathOnlyContextFile(manifestFile.path));
  }

  await loadManifestContextFiles({
    activeFilePath,
    files,
    manifest,
    readFile,
    taskType,
    workspaceRootPath,
  });

  if (readTree) {
    try {
      await loadStatusContextFiles({
        files,
        readTree,
        workspaceRootPath,
      });
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
