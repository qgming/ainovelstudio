import { Activity, Bot, Bug, Database, Info, Sparkles, Wrench, type LucideIcon } from "lucide-react";

export type SettingSectionKey = "agents" | "usage" | "models" | "data" | "tools" | "debug" | "about";

export type SettingNavItem = {
  icon: LucideIcon;
  key: SettingSectionKey;
  title: string;
};

export const settingNavItems: SettingNavItem[] = [
  { key: "agents", title: "AGENTS", icon: Bot },
  { key: "models", title: "模型设置", icon: Sparkles },
  { key: "usage", title: "用量统计", icon: Activity },
  { key: "data", title: "数据管理", icon: Database },
  { key: "tools", title: "工具库", icon: Wrench },
  { key: "debug", title: "开发调试", icon: Bug },
  { key: "about", title: "关于我们", icon: Info },
];

export function isSettingSectionKey(value: string | undefined): value is SettingSectionKey {
  return settingNavItems.some((item) => item.key === value);
}

export function getSettingNavItem(sectionKey: SettingSectionKey) {
  return settingNavItems.find((item) => item.key === sectionKey) ?? settingNavItems[0];
}
