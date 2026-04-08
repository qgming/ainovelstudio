import { PageShell } from "../components/PageShell";
import { SubAgentRow } from "../components/agents/SubAgentRow";
import { useSubAgentStore } from "../stores/subAgentStore";

export function AgentsPage() {
  const subAgents = useSubAgentStore((state) => state.subAgents);
  const toggleSubAgent = useSubAgentStore((state) => state.toggleSubAgent);
  const enabledCount = subAgents.filter((a) => a.enabled).length;

  const builtinAgents = subAgents.filter((a) => a.source === "builtin");
  const importedAgents = subAgents.filter((a) => a.source === "imported");

  return (
    <PageShell title="代理">
      <div className="h-full overflow-y-auto pr-1">
        <div className="max-w-4xl space-y-3 pb-6">
          <section className="rounded-[10px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]">
            <div className="border-b border-[#e2e8f0] px-4 py-2 dark:border-[#20242b]">
              <h2 className="text-sm font-semibold text-[#111827] dark:text-zinc-100">
                内置代理 · 已启用 {builtinAgents.filter((a) => a.enabled).length}
              </h2>
            </div>
            <div className="divide-y divide-[#e2e8f0] dark:divide-[#20242b]">
              {builtinAgents.map((agent) => (
                <SubAgentRow
                  key={agent.id}
                  agent={agent}
                  onToggle={() => toggleSubAgent(agent.id)}
                />
              ))}
            </div>
          </section>

          {importedAgents.length > 0 ? (
            <section className="rounded-[10px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]">
              <div className="border-b border-[#e2e8f0] px-4 py-2 dark:border-[#20242b]">
                <h2 className="text-sm font-semibold text-[#111827] dark:text-zinc-100">
                  导入代理 · 已启用 {importedAgents.filter((a) => a.enabled).length}
                </h2>
              </div>
              <div className="divide-y divide-[#e2e8f0] dark:divide-[#20242b]">
                {importedAgents.map((agent) => (
                  <SubAgentRow
                    key={agent.id}
                    agent={agent}
                    onToggle={() => toggleSubAgent(agent.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <p className="px-1 text-xs text-[#64748b] dark:text-zinc-400">
            已启用 {enabledCount} 个代理。启用后的代理将参与 Agent 工作流的多角色协作。
          </p>
        </div>
      </div>
    </PageShell>
  );
}
