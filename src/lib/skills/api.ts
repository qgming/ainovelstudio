import { invoke } from "@tauri-apps/api/core";
import type { InvokeCancellationOptions } from "../bookWorkspace/api";

async function invokeWithCancellation<T>(
  command: string,
  payload: Record<string, unknown>,
  options?: InvokeCancellationOptions,
) {
  const requestId = options?.requestId;
  const abortSignal = options?.abortSignal;

  if (!requestId || !abortSignal) {
    return invoke<T>(command, payload);
  }

  if (abortSignal.aborted) {
    await invoke<void>("cancel_tool_request", { requestId }).catch(() => undefined);
    throw new DOMException("Tool execution aborted.", "AbortError");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handleAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      abortSignal.removeEventListener("abort", handleAbort);
      void invoke<void>("cancel_tool_request", { requestId }).catch(() => undefined);
      reject(new DOMException("Tool execution aborted.", "AbortError"));
    };

    abortSignal.addEventListener("abort", handleAbort, { once: true });
    void invoke<T>(command, { ...payload, requestId })
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        abortSignal.removeEventListener("abort", handleAbort);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        abortSignal.removeEventListener("abort", handleAbort);
        reject(error);
      });
  });
}

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

export function pickSkillArchive() {
  return invoke<string | null>("pick_skill_archive");
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

export function importSkillZip(zipPath: string) {
  return invoke<SkillManifest[]>("import_skill_zip", { zipPath });
}

