import type { KeyboardEvent } from "react";
import type { SubAgentDefinition } from "../../stores/subAgentStore";
import { Switch } from "../ui/Switch";

type SubAgentRowProps = {
  agent: SubAgentDefinition;
  onOpen: () => void;
  onToggle: () => void;
};

export function SubAgentRow({ agent, onOpen, onToggle }: SubAgentRowProps) {
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
            {agent.name}
          </h3>
          <Switch checked={agent.enabled} label={`切换代理 ${agent.name}`} onChange={() => onToggle()} />
        </div>

        <div className="min-h-0 flex-1 pt-3">
          <p className="line-clamp-2 text-xs leading-5 text-[#526074] dark:text-zinc-300">
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
