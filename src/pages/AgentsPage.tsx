import { Plus, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SubAgentRow } from "../components/agents/SubAgentRow";
import { useSubAgentStore } from "../stores/subAgentStore";

export function AgentsPage() {
  const navigate = useNavigate();
  const subAgents = useSubAgentStore((state) => state.subAgents);
  const toggleSubAgent = useSubAgentStore((state) => state.toggleSubAgent);

  return (
    <PageShell
      title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">代理中心</h1>}
      actions={[
        { icon: Upload, label: "导入代理", tone: "default" },
        { icon: Plus, label: "新建代理", tone: "primary" },
      ]}
    >
      <div className="h-full overflow-y-auto pr-1">
        {subAgents.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 pb-6">
            {subAgents.map((agent) => (
              <SubAgentRow
                key={agent.id}
                agent={agent}
                onOpen={() => navigate(`/agents/${agent.id}`)}
                onToggle={() => toggleSubAgent(agent.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-[16px] border border-dashed border-[#d7dde8] bg-[#fbfbfc] px-6 text-sm text-[#64748b] dark:border-[#2a3038] dark:bg-[#15171b] dark:text-zinc-400">
            暂无可用代理。
          </div>
        )}
      </div>
    </PageShell>
  );
}
