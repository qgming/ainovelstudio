export const DEFAULT_PROJECT_AGENT_PATH = ".project/AGENTS.md";

export type ProjectContextPayload = {
  source: string;
  files: Array<{
    content: string;
    name: string;
    path: string;
  }>;
};

type LoadProjectContextInput = {
  readFile: (rootPath: string, path: string) => Promise<string>;
  workspaceRootPath: string | null;
};

function getBaseName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export async function loadProjectContext({
  readFile,
  workspaceRootPath,
}: LoadProjectContextInput): Promise<ProjectContextPayload | null> {
  if (!workspaceRootPath) {
    return null;
  }

  try {
    const content = await readFile(workspaceRootPath, DEFAULT_PROJECT_AGENT_PATH);
    if (!content.trim()) {
      return null;
    }

    return {
      source: "项目默认上下文",
      files: [
        {
          content,
          name: getBaseName(DEFAULT_PROJECT_AGENT_PATH),
          path: DEFAULT_PROJECT_AGENT_PATH,
        },
      ],
    };
  } catch {
    return null;
  }
}
