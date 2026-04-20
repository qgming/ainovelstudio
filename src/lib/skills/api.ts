import { invoke } from "@tauri-apps/api/core";
import { invokeWithCancellation, type InvokeCancellationOptions } from "../bookWorkspace/api";

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
  defaultEnabled?: boolean;
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
  templates?: SkillReferenceEntry[];
  templatesPath?: string;
  skillFilePath?: string;
  sourceKind: SkillSourceKind;
  suggestedTools: string[];
  tags: string[];
  validation: SkillValidation;
  version?: string;
};

export type TogglePreferences = {
  enabledById: Record<string, boolean>;
};

export type BuiltinSkillsInitializationResult = {
  initializedSkillIds: string[];
  skippedSkillIds: string[];
};

export function readSkillPreferences() {
  return invoke<TogglePreferences>("read_skill_preferences");
}

export function writeSkillPreferences(preferences: TogglePreferences) {
  return invoke<TogglePreferences>("write_skill_preferences", { preferences });
}

export function clearSkillPreferences() {
  return invoke<void>("clear_skill_preferences");
}

export function scanInstalledSkills(options?: InvokeCancellationOptions) {
  return invokeWithCancellation<SkillManifest[]>("scan_installed_skills", {}, options);
}

export function initializeBuiltinSkills() {
  return invoke<BuiltinSkillsInitializationResult>("initialize_builtin_skills");
}

export function resetBuiltinSkills() {
  return invoke<BuiltinSkillsInitializationResult>("reset_builtin_skills");
}

export function readSkillDetail(skillId: string) {
  return invoke<SkillManifest>("read_skill_detail", { skillId });
}

export function readSkillReferenceContent(skillId: string, referencePath: string) {
  return invoke<string>("read_skill_reference_content", { referencePath, skillId });
}

export function readSkillFileContent(skillId: string, relativePath: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("read_skill_file_content", { relativePath, skillId }, options);
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

export function importSkillZip(fileName: string, archiveBytes: number[]) {
  return invoke<SkillManifest[]>("import_skill_zip", { fileName, archiveBytes });
}
