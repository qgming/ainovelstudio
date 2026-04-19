import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { Claude, Gemini, ProviderIcon, Qwen, SiliconCloud, XiaomiMiMo, Zhipu } from "@lobehub/icons";
import { Cable, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, PlugZap, RotateCcw, Save } from "lucide-react";
import { ModelCatalogButton } from "./ModelCatalogButton";
import { Toast, type ToastTone } from "../common/Toast";
import { testAgentProviderConnection } from "../../lib/agent/modelGateway";
import type { ProviderConnectionTestResult } from "../../lib/agent/modelGateway";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { MODEL_PROVIDER_RECOMMENDATIONS } from "./modelProviderRecommendations";
import { SettingsHeaderResponsiveButton, SettingsSectionHeader } from "./SettingsSectionHeader";
import { cn } from "../../lib/utils";
import { useIsMobile } from "../../hooks/use-mobile";

type ModelProviderCardProps = {
  config: AgentProviderConfig;
  isDirty: boolean;
  isSaving?: boolean;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
  onReset: () => void;
  onSave: () => void | Promise<void>;
};

type ToastState = {
  description?: string;
  title: string;
  tone: ToastTone;
};

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

export function ModelProviderCard({ config, isDirty, isSaving = false, onChange, onReset, onSave }: ModelProviderCardProps) {
  const isMobile = useIsMobile();
  const baseUrl = config.baseURL.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const normalizedBaseUrl = normalizeUrlForCompare(baseUrl);
  const canTestConnection = baseUrl.length > 0 && apiKey.length > 0 && model.length > 0 && !isTesting;
  const canSave = isDirty && !isSaving;

  useEffect(() => {
    setToast(null);
  }, [baseUrl, apiKey, model, config.simulateOpencodeBeta]);

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
            <ModelCatalogButton
              config={config}
              iconOnly={isMobile}
              onSelectModel={(nextModel) => onChange({ model: nextModel })}
              onError={handleCatalogError}
            />
            <SettingsHeaderResponsiveButton
              type="button"
              label={isSaving ? "保存中..." : "保存"}
              disabled={!canSave}
              size={isMobile ? "icon-sm" : "sm"}
              text="保存"
              icon={isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              onClick={() => void onSave()}
            />
            <SettingsHeaderResponsiveButton
              type="button"
              label={isTesting ? "测试中..." : "测试连接"}
              disabled={!canTestConnection}
              size={isMobile ? "icon-sm" : "sm"}
              text="测试连接"
              icon={isTesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Cable className="h-3.5 w-3.5" />}
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
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsApiKeyVisible((current) => !current)}
                className="absolute inset-y-0 right-0 my-auto mr-1 text-muted-foreground"
              >
                {isApiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Model</Label>
            <Input
              className="h-9"
              onChange={(event) => onChange({ model: event.target.value })}
              placeholder="gpt-4.1 / gpt-4o / 自定义模型名"
              value={config.model}
            />
          </div>

        <div className="lg:col-span-2 -mx-3">
          <div className="flex items-start justify-between gap-4 border-t border-border px-3 pt-3">
            <div className="min-w-0 pr-4">
              <p className="text-sm font-medium text-foreground">模拟 OpenCode（beta）</p>
            </div>
            <Switch
              checked={Boolean(config.simulateOpencodeBeta)}
              label="切换模拟 OpenCode（beta）"
              onChange={(checked) => onChange({ simulateOpencodeBeta: checked })}
            />
          </div>
        </div>

          <div className="lg:col-span-2 -mx-3">
            <div className="border-t border-border pt-3">
              <div className="mb-3 border-b border-border px-3 pb-3">
                <div>
                  <p className="text-sm font-medium text-foreground">推荐供应商</p>
                </div>
              </div>
              <div
                data-testid="model-provider-recommendations"
                className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
              >
                {MODEL_PROVIDER_RECOMMENDATIONS.map((recommendation) => {
                  const isSelected = normalizeUrlForCompare(recommendation.baseURL) === normalizedBaseUrl;

                  return (
                    <article key={recommendation.id} className="editor-block-tile aspect-square">
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`使用 ${recommendation.name} 地址`}
                        onClick={() => onChange({ baseURL: recommendation.baseURL })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onChange({ baseURL: recommendation.baseURL });
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
