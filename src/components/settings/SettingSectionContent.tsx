import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import appIcon from "../../assets/icon.png";
import packageJson from "../../../package.json";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "../../lib/agent/promptContext";
import { BUILTIN_TOOLS } from "../../lib/agent/toolDefs";
import { getDefaultAgentProviderConfig, useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { DefaultAgentSection } from "./DefaultAgentSection";
import { ModelProviderCard } from "./ModelProviderCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { UsageAnalyticsSection } from "./UsageAnalyticsSection";
import { Switch } from "../ui/Switch";
import type { SettingSectionKey } from "./settingNavigation";
import { DataManagementSection } from "./DataManagementSection";

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

function SettingStatefulSectionContent({ sectionKey }: { sectionKey: Exclude<SettingSectionKey, "about"> }) {
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

  if (sectionKey === "agents") {
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

  if (sectionKey === "usage") {
    return <UsageAnalyticsSection />;
  }

  if (sectionKey === "models") {
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

  if (sectionKey === "data") {
    return <DataManagementSection />;
  }

  return (
    <ToolLibrarySection
      enabledCount={enabledCount}
      enabledTools={enabledTools}
      toggleTool={toggleTool}
    />
  );
}

export function SettingSectionContent({ sectionKey }: { sectionKey: SettingSectionKey }) {
  if (sectionKey === "about") {
    return <AboutSection />;
  }

  return <SettingStatefulSectionContent sectionKey={sectionKey} />;
}
