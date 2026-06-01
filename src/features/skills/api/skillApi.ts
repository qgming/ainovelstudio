import { invoke } from "@tauri-apps/api/core";
import { invokeWithCancellation, type InvokeCancellationOptions } from "@features/books/api/bookWorkspaceApi";

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
  displayName?: string;
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

// —— skills_root 文件访问（供 pi loadSkills 的 ExecutionEnv 转发）——
// path 相对 app_data_dir/skills/，后端做 .. 越界校验并锁在该目录内。

export type SkillFsEntry = {
  name: string;
  isDir: boolean;
  size: number;
};

export type SkillFsInfo = {
  kind: "file" | "directory";
  size: number;
};

export function skillFsRead(path: string) {
  return invoke<string>("skill_fs_read", { path });
}

export function skillFsFileInfo(path: string) {
  return invoke<SkillFsInfo | null>("skill_fs_file_info", { path });
}

export function skillFsListDir(path: string) {
  return invoke<SkillFsEntry[]>("skill_fs_list_dir", { path });
}
