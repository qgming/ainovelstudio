import { ChevronRight, History, SquarePen } from "lucide-react";
import { AgentComposer } from "../agent/AgentComposer";
import { AgentMessageList } from "../agent/AgentMessageList";
import { useAgentStore } from "../../stores/agentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { getEnabledAgents, useSubAgentStore } from "../../stores/subAgentStore";

type BookAgentPanelProps = {
  width: number;
};

function ToolbarButton({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {}}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
    >
      {children}
    </button>
  );
}

function AgentHeaderButton() {
  return (
    <button
      type="button"
      aria-label="Agent 面板"
      onClick={() => {}}
      className="flex h-8 min-w-0 items-center gap-0.5 rounded-[10px] px-2 text-left text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] dark:text-[#f3f4f6] dark:hover:bg-[#1a1c21]"
    >
      <ChevronRight className="h-4 w-4 shrink-0 text-black dark:text-white" />
      <span
        role="heading"
        aria-level={2}
        className="truncate text-[15px] font-semibold leading-none tracking-[-0.03em]"
      >
        Agent
      </span>
    </button>
  );
}

export function BookAgentPanel({ width }: BookAgentPanelProps) {
  const baseTags = useAgentStore((state) => state.contextTags);
  const input = useAgentStore((state) => state.input);
  const run = useAgentStore((state) => state.run);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const stopMessage = useAgentStore((state) => state.stopMessage);
  const setInput = useAgentStore((state) => state.setInput);
  const manifests = useSkillsStore((state) => state.manifests);
  const preferences = useSkillsStore((state) => state.preferences);
  const enabledSkills = getEnabledSkills({ manifests, preferences });
  const agentManifests = useSubAgentStore((state) => state.manifests);
  const agentPreferences = useSubAgentStore((state) => state.preferences);
  const enabledAgents = getEnabledAgents({ manifests: agentManifests, preferences: agentPreferences });
  const contextTags = [
    ...baseTags,
    ...enabledSkills.slice(0, 2).map((skill) => `技能: ${skill.name}`),
    ...enabledAgents.slice(0, 2).map((agent) => `代理: ${agent.name}`),
  ];

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-2 py-1 dark:border-[#20242b]">
        <AgentHeaderButton />
        <div className="flex shrink-0 items-center gap-0.5">
          <ToolbarButton ariaLabel="打开历史记录">
            <History className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton ariaLabel="开始新对话">
            <SquarePen className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>
      <AgentMessageList messages={run.messages} />
      <AgentComposer
        contextTags={contextTags}
        input={input}
        onInputChange={setInput}
        onStop={stopMessage}
        onSubmit={() => {
          void sendMessage();
        }}
        runStatus={run.status}
      />
    </aside>
  );
}

