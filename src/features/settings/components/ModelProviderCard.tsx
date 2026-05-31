import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";
import {
  Claude,
  Gemini,
  ProviderIcon,
  Qwen,
  SiliconCloud,
  XiaomiMiMo,
  Zhipu,
} from "@lobehub/icons";
import {
  Bot,
  Bookmark,
  Cable,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
  Save,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { ModelCatalogButton } from "./ModelCatalogButton";
import { Toast, type ToastTone } from "@shared/components/Toast";
import { testAgentProviderConnection } from "@features/agent/lib/model-gateway";
import type { ProviderConnectionTestResult } from "@features/agent/lib/model-gateway";
import {
  normalizeReasoningEffort,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from "@features/agent/lib/model-gateway/reasoningEffort";
import type {
  AgentProviderConfig,
  AgentProviderPreset,
} from "@features/settings/stores/useAgentSettingsStore";
import { Button } from "@shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import { SegmentedControl } from "@shared/ui/segmented-control";
import { Switch } from "@shared/ui/switch";
import { MODEL_PROVIDER_RECOMMENDATIONS } from "./modelProviderRecommendations";
import { SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";
import { cn } from "@shared/utils";
import { useIsMobile } from "@shared/hooks/useMobile";

type ModelProviderCardProps = {
  config: AgentProviderConfig;
  isDirty: boolean;
  isSaving?: boolean;
  providerPresets: AgentProviderPreset[];
  onAddProviderPreset: (preset: AgentProviderPreset) => void;
  onAutoSaveChange?: (patch: Partial<AgentProviderConfig>) => Promise<void>;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
  onDeleteProviderPreset: (id: string) => void;
  onReset: () => void;
  onSave: () => void | Promise<void>;
};

type ToastState = {
  description?: string;
  title: string;
  tone: ToastTone;
};

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  auto: "自动",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
};

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 0) {
    return "";
  }
  return `${durationMs}ms`;
}

function buildSuccessDescription(_result: ProviderConnectionTestResult) {
  return "连接成功";
}

function buildFailureToast(result: ProviderConnectionTestResult): ToastState {
  const duration = formatDuration(result.diagnostics.durationMs);
  const lines = [result.message];

  if (result.provider.model.trim()) {
    lines.push(`模型：${result.provider.model}`);
  }

  if (duration) {
    lines.push(`耗时：${duration}`);
  }

  const titleMap: Record<ProviderConnectionTestResult["status"], string> = {
    success: "测试成功",
    config_error: "配置无效",
    auth_error: "鉴权失败",
    network_error: "网络不可达",
    model_error: "模型不可用",
    response_invalid: "响应无效",
    unknown_error: "测试失败",
  };

  return {
    title: titleMap[result.status],
    description: lines.join("\n"),
    tone: "error",
  };
}

function normalizeUrlForCompare(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function extractHost(url: string) {
  try {
    return new URL(url.trim()).host;
  } catch {
    return "";
  }
}

function hasRequiredPresetFields(config: AgentProviderConfig) {
  return Boolean(
    config.baseURL.trim() && config.apiKey.trim() && config.model.trim(),
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function deriveProviderFromUrl(url: string) {
  const host = extractHost(url).toLowerCase();
  if (host.includes("deepseek")) return "deepseek";
  if (host.includes("openrouter")) return "openrouter";
  if (host.includes("openai")) return "openai";
  if (host.includes("anthropic")) return "anthropic";
  if (host.includes("google") || host.includes("gemini")) return "google";
  if (host.includes("zhipu") || host.includes("bigmodel")) return "zhipu";
  if (host.includes("siliconflow")) return "siliconflow";
  if (host.includes("qwen") || host.includes("dashscope")) return "qwen";
  return "generic";
}

function renderProviderLogo(provider: string) {
  if (provider === "anthropic") {
    return <Claude.Color size={28} />;
  }

  if (provider === "google") {
    return <Gemini.Color size={28} />;
  }

  if (provider === "zhipu") {
    return <Zhipu.Color size={28} />;
  }

  if (provider === "xiaomi-mimo") {
    return <XiaomiMiMo size={28} />;
  }

  if (provider === "siliconflow") {
    return <SiliconCloud.Color size={28} />;
  }

  if (provider === "qwen") {
    return <Qwen.Color size={28} />;
  }

  return <ProviderIcon provider={provider} size={28} type="color" />;
}

function ModelSettingsPanelSection({
  actions,
  children,
  icon,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      <div className="flex min-h-10 items-center justify-between gap-3 px-3 pt-3 pb-1">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="flex shrink-0 text-muted-foreground">{icon}</span> : null}
          <h3 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">{title}</h3>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function ModelProviderCard({
  config,
  isDirty,
  isSaving = false,
  providerPresets,
  onAddProviderPreset,
  onAutoSaveChange,
  onChange,
  onDeleteProviderPreset,
  onReset,
  onSave,
}: ModelProviderCardProps) {
  const isMobile = useIsMobile();
  const baseUrl = config.baseURL.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  const reasoningEffort = normalizeReasoningEffort(config.reasoningEffort);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const normalizedBaseUrl = normalizeUrlForCompare(baseUrl);
  const canTestConnection =
    baseUrl.length > 0 && apiKey.length > 0 && model.length > 0 && !isTesting;
  const canSave = isDirty && !isSaving;

  useEffect(() => {
    setToast(null);
  }, [
    baseUrl,
    apiKey,
    model,
    reasoningEffort,
    config.simulateOpencodeBeta,
  ]);

  async function handleTestConnection() {
    if (!canTestConnection) {
      return;
    }

    setIsTesting(true);
    setToast(null);

    try {
      const result = await testAgentProviderConnection(config);
      if (result.ok) {
        setToast({
          title: "测试成功",
          description: buildSuccessDescription(result),
          tone: "success",
        });
        return;
      }

      setToast(buildFailureToast(result));
    } finally {
      setIsTesting(false);
    }
  }

  function handleCatalogError(message: string) {
    setToast({
      title: "获取失败",
      description: message,
      tone: "error",
    });
  }

  function handleSaveCurrentAsProviderPreset() {
    if (!hasRequiredPresetFields(config)) {
      setToast({
        title: "保存失败",
        description: "需要完整填写 Base URL、API Key 和 Model",
        tone: "error",
      });
      return;
    }
    const alreadyExists = providerPresets.some(
      (p) => normalizeUrlForCompare(p.baseURL) === normalizedBaseUrl,
    );
    if (alreadyExists) {
      setToast({
        title: "已存在",
        description: "该供应商已在预存供应商中",
        tone: "success",
      });
      return;
    }
    const now = new Date().toISOString();
    onAddProviderPreset({
      id: generateId(),
      name: extractHost(baseUrl) || baseUrl,
      apiKey: config.apiKey,
      model,
      reasoningEffort,
      provider: deriveProviderFromUrl(baseUrl),
      baseURL: config.baseURL,
      createdAt: now,
      updatedAt: now,
    });
    setToast({
      title: "已保存",
      description: "当前供应商已保存到预存供应商",
      tone: "success",
    });
  }

  function handleApplyProviderPreset(preset: AgentProviderPreset) {
    onChange({
      apiKey: preset.apiKey ?? "",
      baseURL: preset.baseURL,
      model: preset.model,
      reasoningEffort: normalizeReasoningEffort(preset.reasoningEffort),
    });
  }

  function handleApplyRecommendation(recommendation: {
    baseURL: string;
    name: string;
    provider: string;
    websiteUrl: string;
  }) {
    onChange({
      baseURL: recommendation.baseURL,
    });
  }

  function handleModelChange(nextModel: string) {
    onChange({
      model: nextModel,
    });
  }

  async function handleAutoSaveChange(
    patch: Partial<AgentProviderConfig>,
    description: string,
  ) {
    if (!onAutoSaveChange) {
      onChange(patch);
      return;
    }

    try {
      await onAutoSaveChange(patch);
      setToast({
        title: "已自动保存",
        description,
        tone: "success",
      });
    } catch (error) {
      setToast({
        title: "保存失败",
        description: getErrorMessage(error, "自动保存失败，请稍后重试。"),
        tone: "error",
      });
    }
  }

  function handleCatalogModelSelect(nextModel: string) {
    return handleAutoSaveChange({ model: nextModel }, "模型选择已保存。");
  }

  function handleReasoningEffortChange(nextReasoningEffort: ReasoningEffort) {
    void handleAutoSaveChange(
      { reasoningEffort: nextReasoningEffort },
      "思考强度已保存。",
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <Toast
        open={toast !== null}
        title={toast?.title ?? ""}
        description={toast?.description}
        tone={toast?.tone}
        onClose={() => setToast(null)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <div className="space-y-2">
          <ModelSettingsPanelSection
            title="模型设置"
            icon={<Bot className="h-4 w-4" />}
            actions={
              <>
                <SettingsHeaderResponsiveButton
                  type="button"
                  label="预存配置"
                  size={isMobile ? "icon-sm" : "sm"}
                  text="预存配置"
                  icon={<Bookmark className="h-3.5 w-3.5" />}
                  onClick={handleSaveCurrentAsProviderPreset}
                />
                <SettingsHeaderResponsiveButton
                  type="button"
                  label={isSaving ? "保存中..." : "保存"}
                  disabled={!canSave}
                  size={isMobile ? "icon-sm" : "sm"}
                  text="保存"
                  icon={
                    isSaving ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={() => void onSave()}
                />
                <SettingsHeaderResponsiveButton
                  type="button"
                  label={isTesting ? "测试中..." : "测试连接"}
                  disabled={!canTestConnection}
                  size={isMobile ? "icon-sm" : "sm"}
                  text="测试连接"
                  icon={
                    isTesting ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Cable className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={() => void handleTestConnection()}
                />
                <SettingsHeaderResponsiveButton
                  type="button"
                  label="重置"
                  size={isMobile ? "icon-sm" : "sm"}
                  text="重置"
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  onClick={onReset}
                />
              </>
            }
          >
        <div className="grid gap-4 px-4 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              <Cable className="h-3.5 w-3.5" />
              Base URL
            </Label>
            <Input
              className="h-9"
              onChange={(event) => onChange({ baseURL: event.target.value })}
              placeholder="https://example.com/v1"
              value={config.baseURL}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              Model
            </Label>
            <div className="relative">
              <Input
                className="h-9 pr-11"
                onChange={(event) => handleModelChange(event.target.value)}
                placeholder="gpt-4.1 / gpt-4o / 自定义模型名"
                value={config.model}
              />
              <ModelCatalogButton
                config={config}
                onSelectModel={handleCatalogModelSelect}
                onError={handleCatalogError}
                className="absolute inset-y-0 right-0 my-auto mr-1"
              />
            </div>
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              API Key
            </Label>
            <div className="relative">
              <Input
                type={isApiKeyVisible ? "text" : "password"}
                className="h-9 pr-10"
                onChange={(event) => onChange({ apiKey: event.target.value })}
                placeholder="sk-..."
                value={config.apiKey}
              />
              <Button
                type="button"
                aria-label={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                title={
                  isApiKeyVisible
                    ? "隐藏 API Key — 隐藏当前输入的密钥内容"
                    : "显示 API Key — 查看当前输入的密钥内容"
                }
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsApiKeyVisible((current) => !current)}
                className="absolute inset-y-0 right-0 my-auto mr-1 text-muted-foreground"
              >
                {isApiKeyVisible ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Gauge className="h-3.5 w-3.5" />
                    思考强度
                  </p>
                </div>
                <SegmentedControl
                  ariaLabel="思考强度"
                  className="md:w-auto md:justify-end"
                  disabled={isSaving}
                  isBusy={isSaving}
                  onValueChange={handleReasoningEffortChange}
                  options={REASONING_EFFORT_OPTIONS.map((option) => ({
                    label: REASONING_EFFORT_LABELS[option],
                    value: option,
                  }))}
                  value={reasoningEffort}
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 pr-4">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  模拟 OpenCode（beta）
                </p>
              </div>
              <Switch
                checked={Boolean(config.simulateOpencodeBeta)}
                label="切换模拟 OpenCode（beta）"
                onChange={(checked) =>
                  onChange({ simulateOpencodeBeta: checked })
                }
              />
            </div>
          </div>
          </div>
          </ModelSettingsPanelSection>

          <ModelSettingsPanelSection
            title="预存供应商"
            icon={<Bookmark className="h-4 w-4" />}
          >
            {providerPresets.length === 0 ? (
              <p className="px-3 pt-2 pb-3 text-sm text-muted-foreground">
                暂无预存供应商，填写模型设置后点击上方的预存配置添加。
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 px-3 pt-2 pb-3">
                {providerPresets.map((preset) => {
                  return (
                    <article
                      key={preset.id}
                      className="min-w-0 rounded-[8px] border border-border bg-background transition-colors hover:bg-accent/35"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`使用 ${preset.name} 地址`}
                        onClick={() => handleApplyProviderPreset(preset)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleApplyProviderPreset(preset);
                          }
                        }}
                        className="relative flex min-h-[64px] cursor-pointer items-center gap-2 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-medium text-foreground">
                            {preset.model || preset.name}
                          </h3>
                          <p
                            title={preset.baseURL}
                            className="mt-1 truncate text-xs leading-5 text-muted-foreground"
                          >
                            {preset.baseURL}
                          </p>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              aria-label={`${preset.name} 更多操作`}
                              title={`${preset.name} 更多操作 — 打开该预存供应商的操作菜单`}
                              variant="outline"
                              size="icon-sm"
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteProviderPreset(preset.id);
                              }}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </ModelSettingsPanelSection>

          <ModelSettingsPanelSection
            title="推荐供应商"
            icon={<Sparkles className="h-4 w-4" />}
          >
            <div
              data-testid="model-provider-recommendations"
              className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
            >
              {MODEL_PROVIDER_RECOMMENDATIONS.map((recommendation) => {
                const isSelected =
                  normalizeUrlForCompare(recommendation.baseURL) ===
                  normalizedBaseUrl;

                return (
                  <article
                    key={recommendation.id}
                    className="editor-block-tile aspect-square"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`使用 ${recommendation.name} 地址`}
                      onClick={() =>
                        handleApplyRecommendation(recommendation)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleApplyRecommendation(recommendation);
                        }
                      }}
                      className={cn(
                        "editor-block-content relative h-full cursor-pointer overflow-hidden rounded-none border border-transparent transition-colors",
                        isSelected
                          ? "bg-accent/35 text-foreground ring-1 ring-border"
                          : "hover:bg-accent/40",
                      )}
                    >
                      <Button
                        type="button"
                        aria-label={`查看 ${recommendation.name} 详情`}
                        title={`查看 ${recommendation.name} 详情 — 打开该供应商的官方网站`}
                        variant="outline"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openUrl(recommendation.websiteUrl);
                        }}
                        className="absolute top-3 right-3"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>

                      <div className="flex h-full flex-col">
                        <div className="flex min-h-[40px] items-center">
                          {renderProviderLogo(recommendation.provider)}
                        </div>

                        <div className="mt-3 min-w-0">
                          <h3 className="pr-8 text-base font-semibold tracking-[-0.03em] text-foreground">
                            {recommendation.name}
                          </h3>
                          <p
                            title={recommendation.baseURL}
                            className="mt-2 overflow-hidden break-all pr-8 text-xs leading-5 text-muted-foreground"
                            style={{
                              display: "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: 4,
                            }}
                          >
                            {recommendation.baseURL}
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </ModelSettingsPanelSection>
        </div>
      </div>
    </section>
  );
}
