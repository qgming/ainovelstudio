import { Wrench } from "lucide-react";
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
    <article className="flex aspect-square flex-col border-r border-b border-[#e2e8f0] px-3 py-3 transition-colors hover:bg-[#f5f8fc] dark:border-[#20242b] dark:hover:bg-[#171b21]">
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={handleKeyDown}
        className="flex min-h-0 flex-1 cursor-pointer flex-col rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0b84e7] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#111214]"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold text-[#111827] dark:text-zinc-100">
            {skill.name}
          </h3>
          <Switch checked={skill.enabled} label={`切换技能 ${skill.name}`} onChange={() => onToggle()} />
        </div>

        <div className="min-h-0 flex-1 pt-3">
          <p className="line-clamp-3 text-xs leading-5 text-[#64748b] dark:text-zinc-400">
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
