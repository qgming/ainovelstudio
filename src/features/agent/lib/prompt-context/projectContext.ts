import type { ContextManifest, ContextManifestPolicy } from "../domain/longformTypes";

export const DEFAULT_PROJECT_AGENT_PATH = ".project/AGENTS.md";
export const DEFAULT_PROJECT_CONTEXT_MANIFEST_PATH = ".project/context-manifest.json";
export const DEFAULT_PROJECT_README_PATH = ".project/README.md";
export const DEFAULT_PROJECT_STATUS_PATH = ".project/status";
const MANIFEST_FILE_LIMIT = 12;
const STATUS_FILE_LIMIT = 4;
const RELATION_FILE_LIMIT = 12;
// 优先级靠前的新双文件结构,后面 4 个为向后兼容旧 5 文件命名。
const STATUS_FILE_PRIORITIES = [
  "project-state.json",
  "story-state.json",
  // legacy filenames (旧版工作区兼容)
  "latest-plot.json",
  "character-state.json",
  "system-state.json",
  "continuity-index.json",
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

function getStatusFilePriority(path: string) {
  const index = STATUS_FILE_PRIORITIES.indexOf(
    getBaseName(path) as (typeof STATUS_FILE_PRIORITIES)[number],
  );
  return index >= 0 ? index : STATUS_FILE_PRIORITIES.length;
}

function getJsonContextDescription(path: string) {
  const name = getBaseName(path);
  const descriptions: Record<string, string> = {
    // 新双文件结构
    "project-state.json":
      "项目级状态真值层，通常记录当前阶段、当前章节、活跃文件、阻塞项和下一步动作。",
    "story-state.json":
      "剧情/人物/连续性合并状态，通常记录当前剧情位置、最近章节、人物状态、关系网、伏笔与连续性风险。",
    // legacy 兼容
    "character-state.json": "人物状态真值层，通常记录角色当前位置、关系、动机、伤势、能力、秘密与阶段性变化。",
    "continuity-index.json": "连续性索引，通常记录伏笔、承接点、未解决事项、时间线和容易前后矛盾的事实。",
    "factory-index.json": "生产索引，通常记录章节生产、资料生成、批量任务或工厂化流程的入口信息。",
    "latest-plot.json": "最新剧情状态，通常记录当前章节、主线目标、近期事件、下一步推进方向和关键冲突。",
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
    includeIfActive: normalizePathList(candidate.includeIfActive),
    priority: typeof candidate.priority === "number" ? candidate.priority : 0,
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
    if (activeFilePath) policy.includeIfActive.forEach((path) => paths.add(path));
  });
  return Array.from(paths).slice(0, MANIFEST_FILE_LIMIT);
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
  workspaceBookId: string;
}) {
  const policyPaths = collectManifestPaths(
    chooseManifestPolicies(params.manifest, params.taskType),
    params.activeFilePath,
  );
  for (const path of policyPaths) {
    pushUniqueContextFile(
      params.files,
      await tryReadContextFile(params.readFile, params.workspaceBookId, path),
    );
  }
}

async function loadStatusContextFiles(params: {
  files: ProjectContextPayload["files"];
  readTree: NonNullable<LoadProjectContextInput["readTree"]>;
  workspaceBookId: string;
}) {
  const tree = await params.readTree(params.workspaceBookId);
  const statusPaths = collectStatusJsonPaths(tree);
  statusPaths.forEach((path) =>
    pushUniqueContextFile(params.files, createPathOnlyContextFile(path))
  );
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
  taskType,
  workspaceBookId,
}: LoadProjectContextInput): Promise<ProjectContextPayload | null> {
  if (!workspaceBookId) {
    return null;
  }

  const files: ProjectContextPayload["files"] = [];
  let manifest: ContextManifest | null = null;

  pushUniqueContextFile(
    files,
    await tryReadContextFile(readFile, workspaceBookId, DEFAULT_PROJECT_AGENT_PATH),
  );
  pushUniqueContextFile(
    files,
    await tryReadContextFile(readFile, workspaceBookId, DEFAULT_PROJECT_README_PATH),
  );

  const manifestFile = await tryReadContextFile(
    readFile,
    workspaceBookId,
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
    workspaceBookId,
  });

  if (readTree) {
    try {
      await loadStatusContextFiles({
        files,
        readTree,
        workspaceBookId,
      });
    } catch {
      // ignore status preload failures and keep other default context
    }
  }

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
