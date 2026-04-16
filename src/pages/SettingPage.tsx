import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, Info, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { DefaultAgentSection } from "../components/settings/DefaultAgentSection";
import { ModelProviderCard } from "../components/settings/ModelProviderCard";
import { SettingsSectionHeader } from "../components/settings/SettingsSectionHeader";
import { UsageAnalyticsSection } from "../components/settings/UsageAnalyticsSection";
import { Switch } from "../components/ui/Switch";
import appIcon from "../assets/icon.png";
import packageJson from "../../package.json";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "../lib/agent/promptContext";
import { BUILTIN_TOOLS } from "../lib/agent/toolDefs";
import { getDefaultAgentProviderConfig, useAgentSettingsStore } from "../stores/agentSettingsStore";

type SettingSectionKey = "agents" | "usage" | "models" | "tools" | "about";

type SettingNavItem = {
  icon: LucideIcon;
  key: SettingSectionKey;
  title: string;
};

const settingNavItems: SettingNavItem[] = [
  { key: "agents", title: "AGENTS", icon: Bot },
  { key: "usage", title: "用量统计", icon: Activity },
  { key: "models", title: "模型设置", icon: Sparkles },
  { key: "tools", title: "工具库", icon: Wrench },
  { key: "about", title: "关于我们", icon: Info },
];

const APP_VERSION = packageJson.version;
const OFFICIAL_WEBSITE = "https://www.qgming.com";

function isSameProviderConfig(
  left: ReturnType<typeof getDefaultAgentProviderConfig>,
  right: ReturnType<typeof getDefaultAgentProviderConfig>,
) {
  return (
    left.apiKey === right.apiKey &&
    left.baseURL === right.baseURL &&
    left.model === right.model &&
    Boolean(left.simulateOpencodeBeta) === Boolean(right.simulateOpencodeBeta)
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader
        title="工具库"
        actions={<span className="text-xs text-muted-foreground">已启用 {enabledCount}</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {BUILTIN_TOOLS.map((toolDef) => {
            const enabled = enabledTools[toolDef.id] ?? true;
            return (
              <article key={toolDef.id} className="editor-block-tile">
                <div className="editor-block-content overflow-hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Tool</p>
                      <h3 className="mt-2 line-clamp-2 text-lg font-medium leading-6 text-foreground">{toolDef.name}</h3>
                      <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{toolDef.id}</p>
                    </div>
                    <Switch
                      checked={enabled}
                      label={enabled ? `禁用 ${toolDef.name}` : `启用 ${toolDef.name}`}
                      onChange={() => toggleTool(toolDef.id)}
                    />
                  </div>

                  <p className="line-clamp-4 text-xs leading-5 text-muted-foreground">{toolDef.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader title="关于我们" icon={<Info className="h-4 w-4" />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-5">
          <div className="flex items-center gap-4">
            <img src={appIcon} alt="神笔写作 Logo" className="h-14 w-14 shrink-0 rounded-[14px] object-contain" />
            <div className="min-w-0">
              <h2 className="truncate text-[22px] font-semibold tracking-[-0.04em] text-[#0f172a] dark:text-white">
                神笔写作
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#64748b] dark:text-zinc-400">版本 {APP_VERSION}</p>
            </div>
          </div>
        </div>

        <div className="border-t border-[#e2e8f0] dark:border-[#20242b]" />

        <div className="px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm leading-6 text-[#64748b] dark:text-zinc-400">官网</p>
            <a
              href={OFFICIAL_WEBSITE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 shrink-0 items-center rounded-[10px] border border-[#dbe3ee] px-3 text-sm font-medium text-[#0f172a] transition hover:border-[#cbd5e1] dark:border-[#2b313b] dark:text-zinc-100 dark:hover:border-[#334155]"
            >
              打开官网
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingPage() {
  const config = useAgentSettingsStore((state) => state.config);
  const defaultAgentMarkdown = useAgentSettingsStore((state) => state.defaultAgentMarkdown);
  const enabledTools = useAgentSettingsStore((state) => state.enabledTools);
  const errorMessage = useAgentSettingsStore((state) => state.errorMessage);
  const initializeAgentSettings = useAgentSettingsStore((state) => state.initialize);
  const saveConfig = useAgentSettingsStore((state) => state.saveConfig);
  const status = useAgentSettingsStore((state) => state.status);
  const refreshDefaultAgentMarkdown = useAgentSettingsStore((state) => state.refreshDefaultAgentMarkdown);
  const toggleTool = useAgentSettingsStore((state) => state.toggleTool);
  const updateDefaultAgentMarkdown = useAgentSettingsStore((state) => state.updateDefaultAgentMarkdown);
  const [activeSection, setActiveSection] = useState<SettingSectionKey>("agents");
  const [agentsDraft, setAgentsDraft] = useState(defaultAgentMarkdown);
  const [agentsDirty, setAgentsDirty] = useState(false);
  const [modelDraft, setModelDraft] = useState(config);
  const [modelDirty, setModelDirty] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);

  useEffect(() => {
    void initializeAgentSettings();
  }, [initializeAgentSettings]);

  useEffect(() => {
    void refreshDefaultAgentMarkdown();
  }, [refreshDefaultAgentMarkdown]);

  useEffect(() => {
    setAgentsDraft(defaultAgentMarkdown);
    setAgentsDirty(false);
  }, [defaultAgentMarkdown]);

  useEffect(() => {
    setModelDraft(config);
    setModelDirty(false);
  }, [config]);

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

  function handleModelDraftChange(patch: Partial<typeof modelDraft>) {
    setModelDraft((current) => {
      const next = { ...current, ...patch };
      setModelDirty(!isSameProviderConfig(next, config));
      return next;
    });
  }

  function handleResetModel() {
    const next = getDefaultAgentProviderConfig();
    setModelDraft(next);
    setModelDirty(!isSameProviderConfig(next, config));
  }

  async function handleSaveModel() {
    setIsSavingModel(true);
    try {
      await saveConfig(modelDraft);
      setModelDirty(false);
    } finally {
      setIsSavingModel(false);
    }
  }

  function renderSectionContent() {
    if (activeSection === "agents") {
      return (
        <DefaultAgentSection
          draftContent={agentsDraft}
          errorMessage={errorMessage}
          isDirty={agentsDirty}
          onChange={handleAgentDraftChange}
          onSave={handleSaveAgents}
          status={status}
        />
      );
    }

    if (activeSection === "usage") {
      return <UsageAnalyticsSection />;
    }

    if (activeSection === "models") {
      return (
        <ModelProviderCard
          config={modelDraft}
          isDirty={modelDirty}
          isSaving={isSavingModel}
          onChange={handleModelDraftChange}
          onReset={handleResetModel}
          onSave={handleSaveModel}
        />
      );
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
        <aside className="w-full shrink-0 overflow-hidden border-b border-border bg-app lg:w-[240px] lg:border-r lg:border-b-0">
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
                    "flex h-11 w-full items-center gap-3 border-b border-border px-3 text-left transition",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  <span className="truncate text-[16px] font-medium leading-none tracking-[-0.03em]">{title}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">{renderSectionContent()}</div>
        </div>
      </div>
    </PageShell>
  );
}
