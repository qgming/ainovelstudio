export type LongformAgentMode =
  | "book-design"
  | "volume-plan"
  | "chapter-write"
  | "continuity-review"
  | "style-polish"
  | "state-maintain";

export type AgentCard = {
  allowedSubagents: string[];
  banTools: string[];
  body: string;
  contextPolicyId: string;
  id: string;
  mode: LongformAgentMode | "book" | "autopilot" | "flow";
  modelPresetId: string | null;
  name: string;
  tools: string[];
  writeScopes: string[];
};

export type ContextManifestPolicy = {
  alwaysInclude: string[];
  charBudget: number;
  fullReadTriggers: string[];
  includeIfActive: string[];
  priority: number;
  summaryFirst: string[];
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
