import { getBaseName } from "../bookWorkspace/paths";
import type { ResolvedSkill } from "../../stores/skillsStore";

export type ManualTurnContextSelection = {
  filePaths: string[];
  skillIds: string[];
};

export type ManualTurnContextPayload = {
  files: Array<{
    content: string;
    name: string;
    path: string;
  }>;
  skills: Array<{
    description: string;
    id: string;
    name: string;
  }>;
};

type ResolveManualTurnContextInput = {
  activeFilePath: string | null;
  draftContent: string;
  enabledSkills: ResolvedSkill[];
  readFile: (rootPath: string, path: string) => Promise<string>;
  selection: ManualTurnContextSelection;
  workspaceRootPath: string | null;
};

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function createEmptyManualTurnContextSelection(): ManualTurnContextSelection {
  return {
    filePaths: [],
    skillIds: [],
  };
}

export function resolveManualTurnContext({
  activeFilePath,
  draftContent,
  enabledSkills,
  readFile,
  selection,
  workspaceRootPath,
}: ResolveManualTurnContextInput): Promise<ManualTurnContextPayload> {
  return Promise.all([
    Promise.resolve(
      enabledSkills
        .filter((skill) => unique(selection.skillIds).includes(skill.id))
        .map((skill) => ({
          description: skill.description,
          id: skill.id,
          name: skill.name,
        })),
    ),
    resolveManualFiles({
      activeFilePath,
      draftContent,
      filePaths: unique(selection.filePaths),
      readFile,
      workspaceRootPath,
    }),
  ]).then(([skills, files]) => ({ files, skills }));
}

async function resolveManualFiles({
  activeFilePath,
  draftContent,
  filePaths,
  readFile,
  workspaceRootPath,
}: {
  activeFilePath: string | null;
  draftContent: string;
  filePaths: string[];
  readFile: (rootPath: string, path: string) => Promise<string>;
  workspaceRootPath: string | null;
}) {
  if (!workspaceRootPath || filePaths.length === 0) {
    return [];
  }

  const files = await Promise.all(
    filePaths.map(async (path) => ({
      content: path === activeFilePath ? draftContent : await readFile(workspaceRootPath, path),
      name: getBaseName(path),
      path,
    })),
  );

  return files;
}
