// 长篇章节级状态类型集合：保留 chapter harness 与正典 delta，
// 移除已废弃的 LongformAgentMode 枚举（原来的 6 张长篇卡片不再使用）。

export type AgentCard = {
  banTools: string[];
  body: string;
  contextPolicyId: string;
  id: string;
  mode: "book" | "autopilot";
  modelPresetId: string | null;
  name: string;
  tools: string[];
  writeScopes: string[];
};

export type ContextManifestPolicy = {
  alwaysInclude: string[];
  includeIfActive: string[];
  priority: number;
  taskType: string;
};

export type ContextManifest = {
  bookName?: string;
  policies: ContextManifestPolicy[];
  version: number;
};

export type ChapterHarnessStage =
  | "chapter-plan"
  | "draft"
  | "continuity-review"
  | "style-polish"
  | "state-maintain"
  | "final-check";

export type CanonDelta = {
  characterUpdates: unknown[];
  continuityRisks: unknown[];
  foreshadowingUpdates: unknown[];
  plotUpdates: unknown[];
  styleNotes: string[];
  timelineUpdates: unknown[];
};

export type ChapterRun = {
  canonDelta: CanonDelta | null;
  chapterNo: number;
  checks: Record<string, unknown>;
  error: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  stage: ChapterHarnessStage;
  status: "pending" | "running" | "blocked" | "completed" | "failed";
  updatedAt: string;
};
