// 扩写模式数据类型

export type ExpansionSection = "project" | "settings" | "chapters";

export type ExpansionWorkspaceSummary = {
  id: string;
  name: string;
  updatedAt: number;
};

export type ExpansionEntryItem = {
  section: ExpansionSection;
  name: string;
  // project 段：文件相对路径（如 "AGENTS.md"）
  // settings/chapters 段：<编号>-<名称>，如 "001-林风"
  path: string;
  updatedAt: number;
};

export type ExpansionWorkspaceDetail = {
  id: string;
  name: string;
  updatedAt: number;
  projectEntries: ExpansionEntryItem[];
  settingEntries: ExpansionEntryItem[];
  chapterEntries: ExpansionEntryItem[];
};

// ---- JSON 模板（与后端保持一致） ----

export type SettingType = "人物" | "物品" | "地点" | "势力" | "概念";

export type SettingRelation = {
  targetId: string;
  targetName: string;
  relation: string;
};

export type SettingJson = {
  id: string;
  name: string;
  type: SettingType;
  aliases: string[];
  tags: string[];
  summary: string;
  description: string;
  attributes: Record<string, string>;
  relations: SettingRelation[];
  appearChapters: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type ChapterStatus =
  | "draft"
  | "outlined"
  | "drafted"
  | "revised"
  | "done";

export type ChapterEvent = {
  title: string;
  detail: string;
};

export type ChapterForeshadow = {
  title: string;
  detail: string;
  payoffChapterId: string | null;
};

export type ChapterJson = {
  id: string;
  name: string;
  order: number;
  status: ChapterStatus;
  summary: string;
  linkedSettingIds: string[];
  outline: string;
  content: string;
  charCount: number;
  wordCount: number;
  pov: string;
  location: string;
  timeline: string;
  events: ChapterEvent[];
  foreshadowing: ChapterForeshadow[];
  notes: string;
  createdAt: number;
  updatedAt: number;
};
