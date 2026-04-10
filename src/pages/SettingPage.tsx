import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Bot, Info, MoonStar, Settings2, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { DefaultAgentSection } from "../components/settings/DefaultAgentSection";
import { ModelProviderCard } from "../components/settings/ModelProviderCard";
import { Switch } from "../components/ui/Switch";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "../lib/agent/promptContext";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";
import { useAgentSettingsStore } from "../stores/agentSettingsStore";
import { useThemeStore } from "../stores/themeStore";

type SettingSectionKey = "agents" | "basic" | "models" | "tools" | "about";

type SettingNavItem = {
  icon: LucideIcon;
  key: SettingSectionKey;
  title: string;
};

const settingNavItems: SettingNavItem[] = [
  {
    key: "agents",
    title: "AGENTS",
    icon: Bot,
  },
  {
    key: "basic",
    title: "基本设置",
    icon: Settings2,
  },
  {
    key: "models",
    title: "模型设置",
    icon: Sparkles,
  },
  {
    key: "tools",
    title: "工具库",
    icon: Wrench,
  },
  {
    key: "about",
    title: "关于我们",
    icon: Info,
  },
];

function SectionCard({ children }: { children: ReactNode }) {
  return <section className="border-b border-[#e2e8f0] dark:border-[#20242b]">{children}</section>;
}

function ThemeSection({
  theme,
  toggleTheme,
}: {
  theme: "dark" | "light";
  toggleTheme: () => void;
}) {
  return (
    <SectionCard>
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <div className="flex items-center gap-3">
          <MoonStar className="h-4 w-4 shrink-0 text-[#111827] dark:text-[#f3f4f6]" />
          <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
            主题
          </h2>
        </div>
        <button
          type="button"
          aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          onClick={toggleTheme}
          className="inline-flex h-8 items-center rounded-[8px] border border-[#0f172a] bg-[#0f172a] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#1e293b] dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
        >
          {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        </button>
      </div>
    </SectionCard>
  );
}

function ToolLibrarySection({
  enabledCount,
  enabledTools,
  toggleTool,
}: {
  enabledCount: number;
  enabledTools: Record<string, boolean>;
  toggleTool: (toolId: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
          内置工具
        </h2>
        <span className="text-xs text-[#64748b] dark:text-zinc-400">内置工具 · 已启用 {enabledCount}</span>
      </div>
      <div className="grid border-t border-[#e2e8f0] sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 dark:border-[#20242b]">
        {BUILTIN_TOOLS.map((toolDef) => {
          const enabled = enabledTools[toolDef.id] ?? true;
          return (
            <div
              key={toolDef.id}
              className="aspect-square border-r border-b border-[#e2e8f0] px-3 py-3 dark:border-[#20242b]"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1 pr-2">
                    <h3 className="text-sm font-medium text-[#111827] dark:text-zinc-100">{toolDef.name}</h3>
                    <p className="text-xs text-[#64748b] dark:text-zinc-400">{toolDef.id}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    label={enabled ? `禁用 ${toolDef.name}` : `启用 ${toolDef.name}`}
                    onChange={() => toggleTool(toolDef.id)}
                  />
                </div>
                <div className="flex min-h-0 flex-1 items-end pt-3">
                  <p className="line-clamp-4 text-xs leading-6 text-[#64748b] dark:text-zinc-400">{toolDef.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="border-b border-[#e2e8f0] dark:border-[#20242b]">
      <div className="space-y-2 px-3 py-3 text-sm text-[#475569] dark:text-zinc-300">
        <div className="flex items-center gap-3 text-[#111827] dark:text-[#f3f4f6]">
          <Info className="h-4 w-4 shrink-0" />
          <h2 className="text-[15px] font-semibold tracking-[-0.03em]">AI Novel Studio</h2>
        </div>
        <p>面向创作工作流的桌面端写作环境，聚合图书工作区、模型配置、默认 AGENTS 与 Agent 工具能力。</p>
        <p>当前设置页采用左侧导航、右侧编辑的双栏布局，方便集中维护主对话和模型行为。</p>
      </div>
    </section>
  );
}

export function SettingPage() {
  const config = useAgentSettingsStore((state) => state.config);
  const defaultAgentMarkdown = useAgentSettingsStore((state) => state.defaultAgentMarkdown);
  const enabledTools = useAgentSettingsStore((state) => state.enabledTools);
  const resetConfig = useAgentSettingsStore((state) => state.resetConfig);
  const resetDefaultAgentMarkdown = useAgentSettingsStore((state) => state.resetDefaultAgentMarkdown);
  const toggleTool = useAgentSettingsStore((state) => state.toggleTool);
  const updateConfig = useAgentSettingsStore((state) => state.updateConfig);
  const updateDefaultAgentMarkdown = useAgentSettingsStore((state) => state.updateDefaultAgentMarkdown);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const [activeSection, setActiveSection] = useState<SettingSectionKey>("agents");
  const [agentsDraft, setAgentsDraft] = useState(defaultAgentMarkdown);
  const [agentsDirty, setAgentsDirty] = useState(false);

  useEffect(() => {
    setAgentsDraft(defaultAgentMarkdown);
    setAgentsDirty(false);
  }, [defaultAgentMarkdown]);

  const enabledCount = useMemo(() => Object.values(enabledTools).filter(Boolean).length, [enabledTools]);

  function handleAgentDraftChange(value: string) {
    setAgentsDraft(value);
    setAgentsDirty(value !== defaultAgentMarkdown);
  }

  async function handleSaveAgents() {
    const normalized = agentsDraft.trim() ? agentsDraft : defaultAgentMarkdown || DEFAULT_MAIN_AGENT_MARKDOWN;
    try {
      await updateDefaultAgentMarkdown(normalized);
      setAgentsDraft(normalized);
      setAgentsDirty(false);
    } catch {
      // 错误状态由 store 统一维护，这里保留当前草稿以便继续编辑。
    }
  }

  async function handleResetAgents() {
    try {
      await resetDefaultAgentMarkdown();
      setAgentsDirty(false);
    } catch {
      // 重置失败时保留当前草稿，避免覆盖用户输入。
    }
  }

  function renderSectionContent() {
    if (activeSection === "agents") {
      return (
        <DefaultAgentSection
          draftContent={agentsDraft}
          isDirty={agentsDirty}
          onChange={handleAgentDraftChange}
          onReset={handleResetAgents}
          onSave={handleSaveAgents}
        />
      );
    }

    if (activeSection === "basic") {
      return <ThemeSection theme={theme} toggleTheme={toggleTheme} />;
    }

    if (activeSection === "models") {
      return <ModelProviderCard config={config} onChange={updateConfig} onReset={resetConfig} />;
    }

    if (activeSection === "tools") {
      return (
        <ToolLibrarySection
          enabledCount={enabledCount}
          enabledTools={enabledTools}
          toggleTool={toggleTool}
        />
      );
    }

    return <AboutSection />;
  }

  return (
    <PageShell
      title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">设置</h1>}
      contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
    >
      <div className="flex h-full min-h-0 flex-col gap-0 lg:flex-row">
        <aside className="w-full shrink-0 overflow-hidden border-b border-[#e2e8f0] dark:border-[#20242b] lg:w-[240px] lg:border-r lg:border-b-0">
          <div>
            {settingNavItems.map(({ icon: Icon, key, title }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={title}
                  onClick={() => setActiveSection(key)}
                  className={[
                    "flex h-10 w-full items-center gap-3 border-b border-[#e2e8f0] px-3 text-left transition dark:border-[#20242b]",
                    isActive
                      ? "bg-[#eaf3ff] text-[#0f172a] dark:bg-[#162131] dark:text-[#f8fbff]"
                      : "text-[#334155] hover:bg-[#eef2f7] dark:text-[#cbd5e1] dark:hover:bg-[#171b21]",
                  ].join(" ")}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  <span className="truncate text-[16px] font-medium leading-none tracking-[-0.03em]">{title}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div>{renderSectionContent()}</div>
        </div>
      </div>
    </PageShell>
  );
}

