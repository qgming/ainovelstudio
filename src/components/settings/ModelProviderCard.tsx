import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { Claude, Gemini, ProviderIcon, Qwen, SiliconCloud, XiaomiMiMo, Zhipu } from "@lobehub/icons";
import { Cable, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, PlugZap } from "lucide-react";
import { Toast, type ToastTone } from "../common/Toast";
import { testAgentProviderConnection } from "../../lib/agent/modelGateway";
import type { ProviderConnectionTestResult } from "../../lib/agent/modelGateway";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import { MODEL_PROVIDER_RECOMMENDATIONS } from "./modelProviderRecommendations";
import { SettingsHeaderButton, SettingsSectionHeader } from "./SettingsSectionHeader";

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

const inputClassName =
  "h-9 w-full rounded-[8px] border border-[#d8dee8] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#94a3b8] dark:border-[#2b313a] dark:bg-[#16191f] dark:text-zinc-100";

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
  }, [baseUrl, apiKey, model]);

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
            <SettingsHeaderButton
              type="button"
              disabled={!canSave}
              onClick={() => void onSave()}
            >
              {isSaving ? "保存中..." : "保存"}
            </SettingsHeaderButton>
            <SettingsHeaderButton
              type="button"
              disabled={!canTestConnection}
              onClick={() => void handleTestConnection()}
            >
              {isTesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Cable className="h-3.5 w-3.5" />}
              {isTesting ? "测试中..." : "测试连接"}
            </SettingsHeaderButton>
            <SettingsHeaderButton type="button" onClick={onReset}>
              重置
            </SettingsHeaderButton>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-3 px-3 py-3 lg:grid-cols-2">
          <label className="block">
          <span className="mb-1.5 inline-flex items-center gap-2 text-xs font-medium text-[#475569] dark:text-zinc-300">
            <Cable className="h-3.5 w-3.5" />
            Base URL
          </span>
          <input
            className={inputClassName}
            onChange={(event) => onChange({ baseURL: event.target.value })}
            placeholder="https://example.com/v1"
            value={config.baseURL}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 inline-flex items-center gap-2 text-xs font-medium text-[#475569] dark:text-zinc-300">
            <KeyRound className="h-3.5 w-3.5" />
            API Key
          </span>
          <div className="relative">
            <input
              type={isApiKeyVisible ? "text" : "password"}
              className={`${inputClassName} pr-10`}
              onChange={(event) => onChange({ apiKey: event.target.value })}
              placeholder="sk-..."
              value={config.apiKey}
            />
            <button
              type="button"
              aria-label={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
              onClick={() => setIsApiKeyVisible((current) => !current)}
              className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-[#64748b] transition-colors hover:text-[#0f172a] dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {isApiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-[#475569] dark:text-zinc-300">Model</span>
          <input
            className={inputClassName}
            onChange={(event) => onChange({ model: event.target.value })}
            placeholder="gpt-4.1 / gpt-4o / 自定义模型名"
            value={config.model}
          />
        </label>

          <div className="lg:col-span-2">
            <div className="border-t border-[#e2e8f0] pt-3 dark:border-[#20242b]">
              <div className="grid grid-cols-5 border-t border-l border-[#e2e8f0] 2xl:grid-cols-7 dark:border-[#20242b]">
              {MODEL_PROVIDER_RECOMMENDATIONS.map((recommendation) => {
                const isSelected = normalizeUrlForCompare(recommendation.baseURL) === normalizedBaseUrl;

                return (
                  <div
                    key={recommendation.id}
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
                    className={[
                      "relative aspect-square flex flex-col items-start border-r border-b px-3 py-4 text-left transition-colors cursor-pointer dark:border-[#20242b]",
                      isSelected
                        ? "border-[#cbd5e1] dark:border-[#3a4352]"
                        : "border-[#e2e8f0] hover:bg-[#f8fafc] dark:hover:bg-[#171b21]",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      aria-label={`查看 ${recommendation.name} 详情`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openUrl(recommendation.websiteUrl);
                      }}
                      className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#d7dde8] text-[#475569] transition-colors hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex h-10 items-center justify-start">
                      {renderProviderLogo(recommendation.provider)}
                    </div>
                    <span className="mt-3 text-sm font-medium text-[#111827] dark:text-zinc-100">{recommendation.name}</span>
                    <p
                      title={recommendation.baseURL}
                      className="mt-2 w-full overflow-hidden break-all pr-8 text-xs leading-5 text-[#64748b] dark:text-zinc-400"
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 3,
                      }}
                    >
                      {recommendation.baseURL}
                    </p>
                  </div>
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
