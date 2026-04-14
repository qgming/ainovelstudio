export type TreeNodeKind = "directory" | "file";

export type TreeNode = {
  children?: TreeNode[];
  extension?: string;
  kind: TreeNodeKind;
  name: string;
  path: string;
};

export type WorkspaceSearchMatchType = "directory_name" | "file_name" | "content";

export type WorkspaceSearchMatch = {
  lineNumber?: number;
  lineText?: string;
  matchType: WorkspaceSearchMatchType;
  path: string;
};

export type WorkspaceLineResult = {
  lineNumber: number;
  path: string;
  text: string;
};

export type WorkspaceSnapshot = {
  rootPath: string;
  selectedFilePath: string | null;
};

export type BookWorkspaceSummary = {
  name: string;
  path: string;
  updatedAt: number;
};

export type PromptMode = "createBook" | "createFolder" | "createFile" | "rename";

export type PromptState = {
  confirmLabel: string;
  description: string;
  label: string;
  mode: PromptMode;
  parentPath?: string;
  targetKind?: TreeNodeKind;
  targetPath?: string;
  title: string;
  value: string;
};

export type ConfirmState = {
  confirmLabel: string;
  description: string;
  kind: TreeNodeKind;
  name: string;
  path: string;
  title: string;
};
