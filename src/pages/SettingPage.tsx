import { Check, MonitorCog, MoonStar, Wrench } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { ModelProviderCard } from "../components/settings/ModelProviderCard";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";
import { useAgentSettingsStore } from "../stores/agentSettingsStore";
import { useThemeStore } from "../stores/themeStore";

const settingItems = [
  {
    title: "工作区偏好",
    description: "后续可接入默认模板、自动恢复会话与创作模式预设。",
    icon: MonitorCog,
  },
];

function SettingSectionRow({ description, icon: Icon, title }: (typeof settingItems)[number]) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#edf1f6] text-[#475569] dark:bg-[#1b1f26] dark:text-zinc-200">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-[#111827] dark:text-zinc-100">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[#64748b] dark:text-zinc-400">{description}</p>
      </div>
    </div>
  );
}

export function SettingPage() {
  const config = useAgentSettingsStore((state) => state.config);
  const enabledTools = useAgentSettingsStore((state) => state.enabledTools);
  const resetConfig = useAgentSettingsStore((state) => state.reset);
  const toggleTool = useAgentSettingsStore((state) => state.toggleTool);
  const updateConfig = useAgentSettingsStore((state) => state.updateConfig);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  const enabledCount = Object.values(enabledTools).filter(Boolean).length;

  return (
    <PageShell title="设置">
      <div className="h-full overflow-y-auto pr-1">
        <div className="max-w-4xl space-y-3 pb-6">
          <section className="rounded-[10px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#edf1f6] text-[#475569] dark:bg-[#1b1f26] dark:text-zinc-200">
                  <MoonStar className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[#111827] dark:text-zinc-100">主题</h2>
                  <p className="mt-1 text-xs text-[#64748b] dark:text-zinc-400">
                    当前：{theme === "dark" ? "深色模式" : "浅色模式"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-8 items-center rounded-[8px] border border-[#0f172a] bg-[#0f172a] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#1e293b] dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
              >
                {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              </button>
            </div>
          </section>

          <ModelProviderCard config={config} onChange={updateConfig} onReset={resetConfig} />

          {/* 内置工具列表 */}
          <section className="rounded-[10px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]">
            <div className="border-b border-[#e2e8f0] px-4 py-2 dark:border-[#20242b]">
              <h2 className="text-sm font-semibold text-[#111827] dark:text-zinc-100">
                内置工具 · 已启用 {enabledCount}
              </h2>
            </div>
            <div className="divide-y divide-[#e2e8f0] dark:divide-[#20242b]">
              {BUILTIN_TOOLS.map((toolDef) => {
                const enabled = enabledTools[toolDef.id] ?? true;
                return (
                  <div
                    key={toolDef.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#edf1f6] text-[#475569] dark:bg-[#1b1f26] dark:text-zinc-200">
                        <Wrench className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-[#111827] dark:text-zinc-100">
                          {toolDef.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-[#64748b] dark:text-zinc-400">
                          {toolDef.description}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTool(toolDef.id)}
                      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium transition-colors ${enabled ? "border-[#1f7a52] bg-[#eaf8f0] text-[#1f7a52] dark:border-[#28543f] dark:bg-[#122017] dark:text-[#9dd9b7]" : "border-[#d7dde8] bg-transparent text-[#475569] hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"}`}
                    >
                      {enabled ? <Check className="h-3.5 w-3.5" /> : null}
                      {enabled ? "已启用" : "启用"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {settingItems.map((item) => (
            <section
              key={item.title}
              className="rounded-[10px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]"
            >
              <SettingSectionRow {...item} />
            </section>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
