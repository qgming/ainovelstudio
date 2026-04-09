import { AlertCircle } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { ResolvedSkill } from "../../stores/skillsStore";
import { Switch } from "../ui/Switch";

type SkillCardProps = {
  onOpen: () => void;
  onToggle: () => void;
  skill: ResolvedSkill;
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
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold text-[#111827] dark:text-zinc-100">{skill.name}</h3>
          </div>
          <Switch checked={skill.enabled} label={`切换技能 ${skill.name}`} onChange={() => onToggle()} />
        </div>

        <div className="min-h-0 flex-1 pt-3">
          <p className="line-clamp-3 text-xs leading-5 text-[#64748b] dark:text-zinc-400">{skill.description}</p>
        </div>

        {!skill.validation.isValid ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-[999px] border border-[#f1d1d1] bg-[#fff5f5] px-2 py-0.5 text-[11px] font-medium text-[#b42318] dark:border-[#4a2323] dark:bg-[#221314] dark:text-[#ffb4ab]">
              <AlertCircle className="h-3 w-3" />
              校验异常
            </span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
