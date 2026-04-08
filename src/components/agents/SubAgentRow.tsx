import {
  BookOpen,
  MessageCircleWarning,
  PenLine,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import type { SubAgentDefinition } from "../../stores/subAgentStore";
import { Switch } from "../ui/Switch";

/** lucide 图标名 → 组件映射 */
const avatarMap: Record<string, LucideIcon> = {
  BookOpen,
  MessageCircleWarning,
  PenLine,
  ShieldAlert,
};

type SubAgentRowProps = {
  agent: SubAgentDefinition;
  onOpen: () => void;
  onToggle: () => void;
};

export function SubAgentRow({ agent, onOpen, onToggle }: SubAgentRowProps) {
  const Icon = avatarMap[agent.avatar] ?? PenLine;

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
          <Icon className="h-4.5 w-4.5" />
        </div>
        <Switch checked={agent.enabled} label={`切换代理 ${agent.name}`} onChange={() => onToggle()} />
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
            {agent.name}
          </h3>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#526074] dark:text-zinc-300">
            {agent.role}
          </p>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#64748b] dark:text-zinc-400">
            {agent.description}
          </p>
        </div>
      </div>
    </article>
  );
}
