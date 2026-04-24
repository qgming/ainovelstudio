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
  // settings 段：<编号>-<名称>，如 "001-林风"
  // chapters 段：<分卷>/<名称>，如 "001/第一章"；导出时会写成 <分卷>/<名称>.json
  path: string;
  entryId?: string | null;
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

export type SettingJson = {
  id: string;
  name: string;
  content: string;
  notes: string;
  linkedChapterIds: string[];
};

export type ChapterJson = {
  id: string;
  name: string;
  outline: string;
  content: string;
  notes: string;
  linkedSettingIds: string[];
};
