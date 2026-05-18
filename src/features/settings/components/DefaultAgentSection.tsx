import { FileText, RotateCcw, Save } from "lucide-react";
import { SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";

type DefaultAgentSectionProps = {
  draftContent: string;
  errorMessage?: string | null;
  isDirty: boolean;
  onChange: (value: string) => void;
  onReset: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  status?: "idle" | "loading" | "ready" | "error";
};

export function DefaultAgentSection({
  draftContent,
  errorMessage,
  isDirty,
  onChange,
  onReset,
  onSave,
  status = "idle",
}: DefaultAgentSectionProps) {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-app">
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
          <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 px-3 pt-3 pb-1">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h3 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">AGENTS.md</h3>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <SettingsHeaderResponsiveButton
                type="button"
                text="重置"
                label="重置为内置 AGENTS 并保存"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={onReset}
                disabled={status === "loading"}
              />
              <SettingsHeaderResponsiveButton
                type="button"
                text="保存"
                label="保存 AGENTS"
                icon={<Save className="h-4 w-4" />}
                onClick={onSave}
                disabled={!isDirty || status === "loading"}
              />
            </div>
          </div>
          {errorMessage ? (
            <div className="border-b border-[#f1d5d8] bg-[#fff5f5] px-4 py-2 text-xs text-[#b42318] dark:border-[#44242a] dark:bg-[#231417] dark:text-[#ffb4ab]">
              {errorMessage}
            </div>
          ) : null}
          <textarea
            aria-label="默认 AGENTS 编辑器"
            value={draftContent}
            onChange={(event) => onChange(event.target.value)}
            className="h-full min-h-0 w-full flex-1 resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 text-[15px] leading-8 text-foreground outline-none"
            spellCheck={false}
          />
        </div>
      </div>
    </section>
  );
}
