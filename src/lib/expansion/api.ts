import { invoke } from "@tauri-apps/api/core";
import type {
  ExpansionEntryItem,
  ExpansionSection,
  ExpansionWorkspaceDetail,
  ExpansionWorkspaceSummary,
} from "./types";

export function listExpansionWorkspaces() {
  return invoke<ExpansionWorkspaceSummary[]>("list_expansion_workspaces");
}

export function createExpansionWorkspace(bookName: string) {
  return invoke<ExpansionWorkspaceSummary>("create_expansion_workspace", {
    bookName,
  });
}

export function deleteExpansionWorkspace(workspaceId: string) {
  return invoke<void>("delete_expansion_workspace", { workspaceId });
}

export function getExpansionWorkspaceDetail(workspaceId: string) {
  return invoke<ExpansionWorkspaceDetail>("get_expansion_workspace_detail", {
    workspaceId,
  });
}

export function readExpansionEntry(
  workspaceId: string,
  section: ExpansionSection,
  path: string,
) {
  return invoke<string>("read_expansion_entry", {
    workspaceId,
    section,
    path,
  });
}

export function writeExpansionEntry(
  workspaceId: string,
  section: ExpansionSection,
  path: string,
  contents: string,
) {
  return invoke<void>("write_expansion_entry", {
    workspaceId,
    section,
    path,
    contents,
  });
}

export function createExpansionEntry(
  workspaceId: string,
  section: Exclude<ExpansionSection, "project">,
  name: string,
  parentPath?: string,
) {
  return invoke<ExpansionEntryItem>("create_expansion_entry", {
    workspaceId,
    section,
    name,
    parentPath,
  });
}

export function deleteExpansionEntry(
  workspaceId: string,
  section: Exclude<ExpansionSection, "project">,
  path: string,
) {
  return invoke<void>("delete_expansion_entry", {
    workspaceId,
    section,
    path,
  });
}

export function renameExpansionEntry(
  workspaceId: string,
  section: Exclude<ExpansionSection, "project">,
  path: string,
  nextName: string,
) {
  return invoke<ExpansionEntryItem>("rename_expansion_entry", {
    workspaceId,
    section,
    path,
    nextName,
  });
}

export function exportExpansionZip(workspaceId: string) {
  return invoke<string | null>("export_expansion_zip", { workspaceId });
}

export function importExpansionZip(fileName: string, archiveBytes: number[]) {
  return invoke<ExpansionWorkspaceSummary>("import_expansion_zip", {
    fileName,
    archiveBytes,
  });
}

export type ExpansionPromptTemplateItem = {
  actionId: string;
  template: string;
  updatedAt: number;
};

export function listExpansionPromptTemplates(workspaceId: string) {
  return invoke<ExpansionPromptTemplateItem[]>("list_expansion_prompt_templates", {
    workspaceId,
  });
}

export function saveExpansionPromptTemplate(
  workspaceId: string,
  actionId: string,
  template: string,
) {
  return invoke<ExpansionPromptTemplateItem>("save_expansion_prompt_template", {
    workspaceId,
    actionId,
    template,
  });
}

export function resetExpansionPromptTemplate(workspaceId: string, actionId: string) {
  return invoke<void>("reset_expansion_prompt_template", {
    workspaceId,
    actionId,
  });
}
