import { Textarea } from "../../ui/textarea";
import { countWords } from "../../../lib/expansion/templates";
import type { ChapterJson, SettingJson } from "../../../lib/expansion/types";

export function ProjectEditor({
  disabled,
  fitContainer = true,
  onChange,
  value,
}: {
  disabled: boolean;
  fitContainer?: boolean;
  onChange: (next: string) => void;
  value: string;
}) {
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      spellCheck={false}
      className={
        fitContainer
          ? "h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
          : "min-h-[65vh] w-full resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
      }
    />
  );
}

export function SettingEditor({
  disabled,
  fitContainer = true,
  onChange,
  value,
}: {
  disabled: boolean;
  fitContainer?: boolean;
  onChange: (next: SettingJson) => void;
  value: SettingJson;
}) {
  return (
    <Textarea
      value={value.content}
      onChange={(event) => onChange({ ...value, content: event.target.value })}
      disabled={disabled}
      spellCheck={false}
      className={
        fitContainer
          ? "h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
          : "min-h-[65vh] w-full resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
      }
    />
  );
}

export function ChapterEditor({
  disabled,
  fitContainer = true,
  onChange,
  value,
}: {
  disabled: boolean;
  fitContainer?: boolean;
  onChange: (next: ChapterJson) => void;
  value: ChapterJson;
}) {
  return (
    <div className={fitContainer ? "h-full min-h-0 overflow-y-auto" : "overflow-visible"}>
      <div className={fitContainer ? "flex min-h-full flex-col" : "flex flex-col"}>
        <div className="flex min-h-[220px] flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">细纲</span>
            <span className="text-xs text-muted-foreground">{countWords(value.outline)} 字</span>
          </div>
          <Textarea
            value={value.outline}
            onChange={(event) => onChange({ ...value, outline: event.target.value })}
            disabled={disabled}
            spellCheck={false}
            placeholder="当前细纲为空。"
            className="min-h-[220px] w-full resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        <div className="h-px shrink-0 bg-border" />
        <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">正文</span>
            <span className="text-xs text-muted-foreground">{countWords(value.content)} 字</span>
          </div>
          <Textarea
            value={value.content}
            onChange={(event) => onChange({ ...value, content: event.target.value })}
            disabled={disabled}
            spellCheck={false}
            placeholder="当前正文为空。可先补充细纲，再开始写作。"
            className="min-h-[320px] w-full resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2 text-[15px] leading-8 text-foreground focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
      </div>
    </div>
  );
}
