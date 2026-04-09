import { invoke } from "@tauri-apps/api/core";

export type SkillSourceKind = "builtin-package" | "installed-package";

export type SkillReferenceEntry = {
  extension?: string;
  name: string;
  path: string;
  size: number;
};

export type SkillValidation = {
  errors: string[];
  isValid: boolean;
  warnings: string[];
};

export type SkillManifest = {
  author?: string;
  body: string;
  description: string;
  discoveredAt: number;
  frontmatter?: Record<string, unknown>;
  frontmatterRaw?: string;
  id: string;
  installPath?: string;
  isBuiltin: boolean;
  name: string;
  rawMarkdown: string;
  references: SkillReferenceEntry[];
  referencesPath?: string;
  skillFilePath?: string;
  sourceKind: SkillSourceKind;
  suggestedTools: string[];
  tags: string[];
  validation: SkillValidation;
  version?: string;
};

export type BuiltinSkillsInitializationResult = {
  initializedSkillIds: string[];
  skippedSkillIds: string[];
};

export function pickSkillArchive() {
  return invoke<string | null>("pick_skill_archive");
}

export function scanInstalledSkills() {
  return invoke<SkillManifest[]>("scan_installed_skills");
}

export function initializeBuiltinSkills() {
  return invoke<BuiltinSkillsInitializationResult>("initialize_builtin_skills");
}

export function readSkillDetail(skillId: string) {
  return invoke<SkillManifest>("read_skill_detail", { skillId });
}

export function readSkillReferenceContent(skillId: string, referencePath: string) {
  return invoke<string>("read_skill_reference_content", { referencePath, skillId });
}

export function readSkillFileContent(skillId: string, relativePath: string) {
  return invoke<string>("read_skill_file_content", { relativePath, skillId });
}

export function writeSkillFileContent(skillId: string, relativePath: string, content: string) {
  return invoke<SkillManifest[]>("write_skill_file_content", { content, relativePath, skillId });
}

export function createSkill(name: string, description: string) {
  return invoke<SkillManifest[]>("create_skill", { description, name });
}

export function createSkillReferenceFile(skillId: string, name: string) {
  return invoke<SkillManifest[]>("create_skill_reference_file", { name, skillId });
}

export function deleteInstalledSkill(skillId: string) {
  return invoke<SkillManifest[]>("delete_installed_skill", { skillId });
}

export function importSkillZip(zipPath: string) {
  return invoke<SkillManifest[]>("import_skill_zip", { zipPath });
}
