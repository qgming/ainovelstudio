import type { KeyboardEvent } from "react";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { Switch } from "../ui/Switch";

type SubAgentRowProps = {
  agent: ResolvedAgent;
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
            <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Agent</p>
            <h3 className="mt-2 line-clamp-2 text-lg font-medium leading-6 text-foreground">{agent.name}</h3>
          </div>
          <Switch checked={agent.enabled} label={`切换代理 ${agent.name}`} onChange={() => onToggle()} />
        </div>

        <p className="line-clamp-4 text-xs leading-5 text-muted-foreground">
          {agent.description}
        </p>
      </div>
    </article>
  );
}
