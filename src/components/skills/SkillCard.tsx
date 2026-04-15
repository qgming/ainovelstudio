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
    <article className="editor-block-tile">
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={handleKeyDown}
        className="editor-block-content cursor-pointer overflow-hidden rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Skill</p>
            <h3 className="mt-2 line-clamp-2 text-lg font-medium leading-6 text-foreground">{skill.name}</h3>
          </div>
          <Switch checked={skill.enabled} label={`切换技能 ${skill.name}`} onChange={() => onToggle()} />
        </div>

        <p className="line-clamp-4 text-xs leading-5 text-muted-foreground">{skill.description}</p>

        <div className="mt-auto flex justify-end">
          {!skill.validation.isValid ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/8 px-2 py-0.5 text-[11px] font-medium text-destructive">
              <AlertCircle className="h-3 w-3" />
              校验异常
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
