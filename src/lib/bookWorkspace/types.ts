export type TreeNodeKind = "directory" | "file";

export type TreeNode = {
  children?: TreeNode[];
  extension?: string;
  kind: TreeNodeKind;
  name: string;
  path: string;
};

export type WorkspaceSnapshot = {
  rootPath: string;
  selectedFilePath: string | null;
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
