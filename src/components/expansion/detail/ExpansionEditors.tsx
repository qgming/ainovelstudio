import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { countChineseChars, countWords } from "../../../lib/expansion/templates";
import type { ChapterJson, SettingJson } from "../../../lib/expansion/types";

function normalizeIdList(value: string) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ProjectEditor({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (next: string) => void;
  value: string;
}) {
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      spellCheck={false}
      className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
    />
  );
}

export function SettingEditor({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (next: SettingJson) => void;
  value: SettingJson;
}) {
  function update<K extends keyof SettingJson>(key: K, next: SettingJson[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <FormSection title="内容">
        <Textarea
          value={value.content}
          onChange={(event) => update("content", event.target.value)}
          disabled={disabled}
          rows={14}
          className="resize-y"
        />
      </FormSection>

      <FormSection title="备注">
        <Textarea
          value={value.notes}
          onChange={(event) => update("notes", event.target.value)}
          disabled={disabled}
          rows={6}
          className="resize-y"
        />
      </FormSection>

      <FormSection title="关联正文 ID（逗号分隔）">
        <Input
          value={value.linkedChapterIds.join(", ")}
          onChange={(event) => update("linkedChapterIds", normalizeIdList(event.target.value))}
          disabled={disabled}
        />
      </FormSection>
    </div>
  );
}

export function ChapterEditor({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (next: ChapterJson) => void;
  value: ChapterJson;
}) {
  function update<K extends keyof ChapterJson>(key: K, next: ChapterJson[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <FormSection title="细纲">
        <Textarea
          value={value.outline}
          onChange={(event) => update("outline", event.target.value)}
          disabled={disabled}
          rows={10}
          className="resize-y"
        />
      </FormSection>

      <FormSection
        title="正文"
        action={
          <span className="text-xs text-muted-foreground">
            中文字符 {countChineseChars(value.content)} · 总字符 {countWords(value.content)}
          </span>
        }
      >
        <Textarea
          value={value.content}
          onChange={(event) => update("content", event.target.value)}
          disabled={disabled}
          rows={18}
          className="resize-y font-mono text-[15px] leading-8"
        />
      </FormSection>

      <FormSection title="备注">
        <Textarea
          value={value.notes}
          onChange={(event) => update("notes", event.target.value)}
          disabled={disabled}
          rows={6}
          className="resize-y"
        />
      </FormSection>

      <FormSection title="关联设定 ID（逗号分隔）">
        <Input
          value={value.linkedSettingIds.join(", ")}
          onChange={(event) => update("linkedSettingIds", normalizeIdList(event.target.value))}
          disabled={disabled}
        />
      </FormSection>
    </div>
  );
}

function FormSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <FileText className="h-3 w-3" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
