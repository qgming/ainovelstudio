export type TreeNodeKind = "directory" | "file";

export type TreeNode = {
  children?: TreeNode[];
  extension?: string;
  kind: TreeNodeKind;
  name: string;
  path: string;
};

export type WorkspaceSearchIntent =
  | "auto"
  | "chapter"
  | "character"
  | "conflict"
  | "fact"
  | "path"
  | "plot"
  | "status";

export type WorkspaceContextHit = {
  adjacentAvailable: boolean;
  endLine: number;
  id: string;
  matchedTerms: string[];
  path: string;
  preview: string;
  reason: string;
  score: number;
  sectionTitle?: string;
  sourceKind: string;
  startLine: number;
};

export type WorkspaceReadSuggestion = {
  endLine: number;
  path: string;
  reason: string;
  startLine: number;
};

export type WorkspaceSearchResult = {
  intent: WorkspaceSearchIntent | string;
  query: string;
  results: WorkspaceContextHit[];
  strategy: string;
  suggestedReads: WorkspaceReadSuggestion[];
  tokenBudget: number;
  truncated: boolean;
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
  id: string;
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
