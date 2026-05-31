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

export type WorkspaceGrepMatch = {
  path: string;
  lineNumber: number;
  line: string;
  before: string[];
  after: string[];
};

export type WorkspaceGrepResult = {
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  matches: WorkspaceGrepMatch[];
  total: number;
  truncated: boolean;
};

export type WorkspaceLineResult = {
  lineNumber: number;
  path: string;
  text: string;
};

export type WorkspaceSnapshot = {
  bookId: string;
  selectedFilePath: string | null;
};

export type BookWorkspaceSummary = {
  id: string;
  name: string;
  path: string;
  updatedAt: number;
};

// 工作区文件之间的无向多对多关联。
// 后端始终保证 entryAPath <= entryBPath(字典序),前端展示时需根据"自身路径"判断对端是哪一侧。
export type WorkspaceRelation = {
  entryAPath: string;
  entryBPath: string;
  id: string;
  note: string | null;
  relationship: string;
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
