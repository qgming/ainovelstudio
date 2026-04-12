import { useEffect, useState } from "react";
import { Cable, Eye, EyeOff, KeyRound, Link2, LoaderCircle, PlugZap } from "lucide-react";
import { Toast, type ToastTone } from "../common/Toast";
import { formatProviderError } from "../../lib/agent/errorFormatting";
import { testAgentProviderConnection } from "../../lib/agent/modelGateway";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";

type ModelProviderCardProps = {
  config: AgentProviderConfig;
  isDirty: boolean;
  isSaving?: boolean;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
  onReset: () => void;
  onSave: () => void | Promise<void>;
};

const inputClassName =
  "h-9 w-full rounded-[8px] border border-[#d8dee8] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#94a3b8] dark:border-[#2b313a] dark:bg-[#16191f] dark:text-zinc-100";

export function ModelProviderCard({ config, isDirty, isSaving = false, onChange, onReset, onSave }: ModelProviderCardProps) {
  const baseUrl = config.baseURL.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [toast, setToast] = useState<{ description?: string; title: string; tone: ToastTone } | null>(null);
  const canTestLink = baseUrl.length > 0 && apiKey.length > 0 && model.length > 0 && !isTesting;
  const canSave = isDirty && !isSaving;

  useEffect(() => {
    setToast(null);
  }, [baseUrl, apiKey, model]);

  async function handleTestLink() {
    if (!canTestLink) {
      return;
    }

    setIsTesting(true);
    setToast(null);

    try {
      await testAgentProviderConnection(config);
      setToast({
        title: "测试成功",
        description: "模型连接正常。",
        tone: "success",
      });
    } catch (error) {
      const description = formatProviderError(error, "模型连接测试失败。", {
        baseURL: config.baseURL,
        model: config.model,
      });
      setToast({
        title: "测试失败",
        description,
        tone: "error",
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <section className="border-b border-[#e2e8f0] dark:border-[#20242b]">
      <Toast
        open={toast !== null}
        title={toast?.title ?? ""}
        description={toast?.description}
        tone={toast?.tone}
        onClose={() => setToast(null)}
      />
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <div className="flex items-center gap-2 text-[#111827] dark:text-[#f3f4f6]">
          <PlugZap className="h-4 w-4" />
          <h2 className="text-[15px] font-semibold tracking-[-0.03em]">模型设置</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void onSave()}
            className="inline-flex h-8 items-center rounded-[8px] border border-[#0f172a] bg-[#0f172a] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
          <button
            type="button"
            disabled={!canTestLink}
            onClick={() => void handleTestLink()}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d7dde8] px-3 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
          >
            {isTesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {isTesting ? "测试中..." : "测试链接"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-8 items-center rounded-[8px] border border-[#d7dde8] px-3 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
          >
            重置
          </button>
        </div>
      </div>

      <div className="grid gap-3 border-t border-[#e2e8f0] px-3 py-3 lg:grid-cols-2 dark:border-[#20242b]">
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
      </div>
    </section>
  );
}
