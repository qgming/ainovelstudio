import { getBaseName } from "@features/books/lib/paths";
import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";

export type ManualTurnContextSelection = {
  filePaths: string[];
  skillIds: string[];
};

export type ManualTurnContextPayload = {
  files: Array<{
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
  enabledSkills,
  selection,
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
      filePaths: unique(selection.filePaths),
    }),
  ]).then(([skills, files]) => ({ files, skills }));
}

function resolveManualFiles({
  filePaths,
}: {
  filePaths: string[];
}) {
  return filePaths.map((path) => ({
    name: getBaseName(path),
    path,
  }));
}
