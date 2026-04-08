import { Cable, KeyRound, PlugZap } from "lucide-react";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";

type ModelProviderCardProps = {
  config: AgentProviderConfig;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
  onReset: () => void;
};

const inputClassName =
  "h-9 w-full rounded-[8px] border border-[#d8dee8] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#94a3b8] dark:border-[#2b313a] dark:bg-[#16191f] dark:text-zinc-100";

export function ModelProviderCard({ config, onChange, onReset }: ModelProviderCardProps) {
  return (
    <section className="border-b border-[#e2e8f0] dark:border-[#20242b]">
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <div className="flex items-center gap-2 text-[#111827] dark:text-[#f3f4f6]">
          <PlugZap className="h-4 w-4" />
          <h2 className="text-[15px] font-semibold tracking-[-0.03em]">模型设置</h2>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 items-center rounded-[8px] border border-[#d7dde8] px-3 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-200 dark:hover:bg-[#1b1f26]"
        >
          重置
        </button>
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
            value={config.baseURL}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 inline-flex items-center gap-2 text-xs font-medium text-[#475569] dark:text-zinc-300">
            <KeyRound className="h-3.5 w-3.5" />
            API Key
          </span>
          <input
            type="password"
            className={inputClassName}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            placeholder="sk-..."
            value={config.apiKey}
          />
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
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#475569] dark:text-zinc-300">Temperature</span>
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            className={inputClassName}
            onChange={(event) => onChange({ temperature: Number(event.target.value || 0) })}
            value={config.temperature}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#475569] dark:text-zinc-300">Max Tokens</span>
          <input
            type="number"
            min="256"
            step="256"
            className={inputClassName}
            onChange={(event) => onChange({ maxOutputTokens: Number(event.target.value || 0) })}
            value={config.maxOutputTokens}
          />
        </label>
      </div>
    </section>
  );
}
