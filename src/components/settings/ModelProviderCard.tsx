import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
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
  Bookmark,
  Cable,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  PlugZap,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { ModelCatalogButton } from "./ModelCatalogButton";
import { Toast, type ToastTone } from "../common/Toast";
import { testAgentProviderConnection } from "../../lib/agent/modelGateway";
import type { ProviderConnectionTestResult } from "../../lib/agent/modelGateway";
import {
  normalizeReasoningEffort,
} from "../../stores/agentSettingsStore";
import type {
  AgentReasoningEffort,
  AgentProviderConfig,
  AgentProviderPreset,
} from "../../stores/agentSettingsStore";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { MODEL_PROVIDER_RECOMMENDATIONS } from "./modelProviderRecommendations";
import {
  SettingsHeaderResponsiveButton,
  SettingsSectionHeader,
} from "./SettingsSectionHeader";
import { cn } from "../../lib/utils";
import { useIsMobile } from "../../hooks/use-mobile";

type ModelProviderCardProps = {
  config: AgentProviderConfig;
  isDirty: boolean;
  isSaving?: boolean;
  providerPresets: AgentProviderPreset[];
  onAddProviderPreset: (preset: AgentProviderPreset) => void;
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

const REASONING_EFFORT_OPTIONS: Array<{
  description: string;
  label: string;
  value: AgentReasoningEffort;
}> = [
  { value: "xhigh", label: "极强", description: "最深度思考" },
  { value: "high", label: "高", description: "偏重推理" },
  { value: "medium", label: "中", description: "均衡输出" },
  { value: "low", label: "低", description: "更快响应" },
];

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

export function ModelProviderCard({
  config,
  isDirty,
  isSaving = false,
  providerPresets,
  onAddProviderPreset,
  onChange,
  onDeleteProviderPreset,
  onReset,
  onSave,
}: ModelProviderCardProps) {
  const isMobile = useIsMobile();
  const baseUrl = config.baseURL.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const normalizedBaseUrl = normalizeUrlForCompare(baseUrl);
  const reasoningEffort = normalizeReasoningEffort(config.reasoningEffort);
  const isReasoningEnabled = Boolean(config.enableReasoningEffort);
  const canTestConnection =
    baseUrl.length > 0 && apiKey.length > 0 && model.length > 0 && !isTesting;
  const canSave = isDirty && !isSaving;

  useEffect(() => {
    setToast(null);
  }, [
    baseUrl,
    apiKey,
    model,
    config.enableReasoningEffort,
    config.reasoningEffort,
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
      enableReasoningEffort: false,
      model: preset.model,
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
      enableReasoningEffort: false,
    });
  }

  function handleModelChange(nextModel: string) {
    onChange({
      enableReasoningEffort: nextModel.trim() === model ? config.enableReasoningEffort : false,
      model: nextModel,
    });
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
      <SettingsSectionHeader
        title="模型设置"
        icon={<PlugZap className="h-4 w-4" />}
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
            <ModelCatalogButton
              config={config}
              iconOnly={isMobile}
              onSelectModel={handleModelChange}
              onError={handleCatalogError}
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
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-3 px-3 py-3 lg:grid-cols-2">
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
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Model</Label>
            <Input
              className="h-9"
              onChange={(event) => handleModelChange(event.target.value)}
              placeholder="gpt-4.1 / gpt-4o / 自定义模型名"
              value={config.model}
            />
          </div>

          <div className="lg:col-span-2 -mx-3">
            <div className="space-y-3 border-t border-border px-3 pt-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium text-foreground">
                    思考模式 reasoning_effort
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    默认关闭。部分模型不支持该参数，请按模型能力手动开启。
                  </p>
                </div>
                <Switch
                  checked={isReasoningEnabled}
                  label="切换思考模式 reasoning_effort"
                  onChange={(checked) =>
                    onChange({ enableReasoningEffort: checked })
                  }
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.12em]",
                      isReasoningEnabled
                        ? "border-border text-muted-foreground uppercase"
                        : "border-dashed border-border/70 text-muted-foreground/80",
                    )}
                  >
                    {isReasoningEnabled ? reasoningEffort : "已关闭"}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="选择 reasoning_effort 强度"
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                >
                  {REASONING_EFFORT_OPTIONS.map((option) => {
                    const selected = isReasoningEnabled && reasoningEffort === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={!isReasoningEnabled}
                        onClick={() =>
                          onChange({ reasoningEffort: option.value })
                        }
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left transition-colors",
                          !isReasoningEnabled
                            ? "cursor-not-allowed border-border/60 bg-muted/35 text-muted-foreground"
                            : selected
                            ? "border-foreground bg-foreground text-background"
                            : "border-border/70 bg-background hover:bg-accent/40",
                        )}
                      >
                        <span className="block text-sm font-medium uppercase">
                          {option.value}
                        </span>
                        <span
                          className={cn(
                            "mt-1 block text-[11px] leading-4",
                            !isReasoningEnabled
                              ? "text-muted-foreground/80"
                              : selected
                              ? "text-background/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {option.label} · {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 -mx-3">
            <div className="flex items-start justify-between gap-4 border-t border-border px-3 pt-3">
              <div className="min-w-0 pr-4">
                <p className="text-sm font-medium text-foreground">
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

          {/* 预存供应商 */}
          <div className="lg:col-span-2 -mx-3">
            <div className="border-t border-border pt-3">
              <div className="border-b border-border px-3 pb-3">
                <p className="text-sm font-medium text-foreground">预存供应商</p>
              </div>
              {providerPresets.length === 0 ? (
                <p className="px-3 pb-3 text-sm text-muted-foreground">
                  暂无预存供应商，点击顶部"预存配置"添加。
                </p>
              ) : (
                <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                  {providerPresets.map((preset) => {
                    return (
                      <article
                        key={preset.id}
                        className="editor-block-tile aspect-square"
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
                          className="editor-block-content relative h-full cursor-pointer overflow-hidden rounded-none border border-transparent transition-colors hover:bg-accent/40"
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                aria-label={`${preset.name} 更多操作`}
                                title={`${preset.name} 更多操作 — 打开该预存供应商的操作菜单`}
                                variant="outline"
                                size="icon-sm"
                                onClick={(e) => e.stopPropagation()}
                                className="absolute top-3 right-3"
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

                          <div className="flex h-full flex-col">
                            <div className="flex min-h-[40px] items-center">
                              {renderProviderLogo(preset.provider)}
                            </div>

                            <div className="mt-3 min-w-0">
                              <h3 className="pr-8 text-base font-semibold tracking-[-0.03em] text-foreground">
                                {preset.model || preset.name}
                              </h3>
                              <p
                                title={preset.baseURL}
                                className="mt-2 overflow-hidden break-all pr-8 text-xs leading-5 text-muted-foreground"
                                style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 4,
                                }}
                              >
                                {preset.baseURL}
                              </p>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 推荐供应商 */}
          <div className="lg:col-span-2 -mx-3">
            <div className="border-t border-border pt-3">
              <div className="border-b border-border px-3 pb-3">
                <p className="text-sm font-medium text-foreground">推荐供应商</p>
              </div>
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
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
