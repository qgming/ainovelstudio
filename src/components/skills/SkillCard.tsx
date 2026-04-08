import { Sparkles, Wrench } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { SkillDefinition } from "../../stores/skillsStore";
import { Switch } from "../ui/Switch";

type SkillCardProps = {
  onOpen: () => void;
  onToggle: () => void;
  skill: SkillDefinition;
};

export function SkillCard({ onOpen, onToggle, skill }: SkillCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <article className="flex aspect-square min-h-[220px] flex-col rounded-[16px] border border-[#e2e8f0] bg-[#fbfbfc] p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition-colors hover:border-[#c8d7ea] hover:shadow-[0_10px_28px_rgba(15,23,42,0.08)] dark:border-[#20242b] dark:bg-[#15171b] dark:hover:border-[#2c3440]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#edf1f6] text-[#475569] dark:bg-[#1b1f26] dark:text-zinc-200">
          <Sparkles className="h-4.5 w-4.5" />
        </div>
        <Switch checked={skill.enabled} label={`切换技能 ${skill.name}`} onChange={() => onToggle()} />
      </div>

      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={handleKeyDown}
        className="mt-4 flex min-h-0 flex-1 cursor-pointer flex-col rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0b84e7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbfbfc] dark:focus-visible:ring-offset-[#15171b]"
      >
        <div className="min-h-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold text-[#111827] dark:text-zinc-100">
            {skill.name}
          </h3>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#64748b] dark:text-zinc-400">
            {skill.description}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {skill.suggestedTools.slice(0, 3).map((toolName) => (
            <span
              key={toolName}
              className="inline-flex items-center gap-1 rounded-[999px] border border-[#d8dee8] bg-white px-2 py-0.5 text-[11px] font-medium text-[#526074] dark:border-[#2e353f] dark:bg-[#171b22] dark:text-[#95a1b3]"
            >
              <Wrench className="h-3 w-3" />
              {toolName}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
