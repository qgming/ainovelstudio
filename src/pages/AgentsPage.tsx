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
      <div className="h-full overflow-y-auto">
        {subAgents.length > 0 ? (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7 dark:border-[#20242b]">
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
          <div className="flex h-full min-h-[240px] items-center justify-center border-t border-[#e2e8f0] px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:text-zinc-400">
            暂无可用代理。
          </div>
        )}
      </div>
    </PageShell>
  );
}
