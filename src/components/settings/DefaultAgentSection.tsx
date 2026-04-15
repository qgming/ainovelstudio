import { Save } from "lucide-react";
import { SettingsHeaderIconButton, SettingsSectionHeader } from "./SettingsSectionHeader";

type DefaultAgentSectionProps = {
  draftContent: string;
  errorMessage?: string | null;
  isDirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  status?: "idle" | "loading" | "ready" | "error";
};

export function DefaultAgentSection({
  draftContent,
  errorMessage,
  isDirty,
  onChange,
  onSave,
  status = "idle",
}: DefaultAgentSectionProps) {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader
        title="AGENTS.md"
        actions={
          <SettingsHeaderIconButton
            type="button"
            aria-label="保存 AGENTS"
            onClick={onSave}
            disabled={!isDirty || status === "loading"}
          >
            <Save className="h-4 w-4" />
          </SettingsHeaderIconButton>
        }
      />
      {errorMessage ? (
        <div className="border-b border-[#f1d5d8] bg-[#fff5f5] px-3 py-2 text-xs text-[#b42318] dark:border-[#44242a] dark:bg-[#231417] dark:text-[#ffb4ab]">
          {errorMessage}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <textarea
          aria-label="默认 AGENTS 编辑器"
          value={draftContent}
          onChange={(event) => onChange(event.target.value)}
          className="h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-[15px] leading-8 text-foreground outline-none"
          spellCheck={false}
        />
      </div>
    </section>
  );
}
