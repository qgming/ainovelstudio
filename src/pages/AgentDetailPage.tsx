import { Link, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { Switch } from "../components/ui/Switch";
import { useSubAgentStore } from "../stores/subAgentStore";

function DetailTitle({ currentLabel, parentLabel, parentTo }: { currentLabel: string; parentLabel: string; parentTo: string }) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">
      <Link to={parentTo} className="transition-colors hover:text-[#475569] dark:hover:text-zinc-300">
        {parentLabel}
      </Link>
      <span className="px-1.5 text-[#94a3b8] dark:text-zinc-500">/</span>
      <span>{currentLabel}</span>
    </div>
  );
}

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const subAgents = useSubAgentStore((state) => state.subAgents);
  const toggleSubAgent = useSubAgentStore((state) => state.toggleSubAgent);
  const agent = subAgents.find((item) => item.id === agentId);

  if (!agent) {
    return (
      <PageShell title={<DetailTitle currentLabel="代理详情" parentLabel="代理中心" parentTo="/agents" />}>
        <div className="flex h-full min-h-[260px] items-center justify-center">
          <div className="w-full max-w-xl rounded-[16px] border border-dashed border-[#d7dde8] bg-[#fbfbfc] px-6 py-10 text-center dark:border-[#2a3038] dark:bg-[#15171b]">
            <h2 className="text-base font-semibold text-[#111827] dark:text-zinc-100">未找到该代理</h2>
            <p className="mt-2 text-sm leading-6 text-[#64748b] dark:text-zinc-400">
              该代理可能已被移除，或当前链接参数无效。
            </p>
            <button
              type="button"
              onClick={() => navigate("/agents")}
              className="mt-4 inline-flex h-9 items-center rounded-[10px] border border-[#d7dde8] px-4 text-sm font-medium text-[#111827] transition-colors hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-100 dark:hover:bg-[#1b1f26]"
            >
              返回代理中心
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={<DetailTitle currentLabel={agent.name} parentLabel="代理中心" parentTo="/agents" />}
      headerRight={
        <div className="flex h-8 items-center">
          <Switch checked={agent.enabled} label={`切换代理 ${agent.name}`} onChange={() => toggleSubAgent(agent.id)} />
        </div>
      }
    >
      <div className="h-full overflow-y-auto pr-1">
        <div className="mx-auto max-w-4xl space-y-4 pb-6">

          <section className="rounded-[16px] border border-[#e2e8f0] bg-[#fbfbfc] p-5 dark:border-[#20242b] dark:bg-[#15171b]">
            <h2 className="text-sm font-semibold text-[#111827] dark:text-zinc-100">详细说明</h2>
            <div className="mt-3 rounded-[12px] border border-[#e2e8f0] bg-white p-4 text-sm leading-7 text-[#334155] dark:border-[#2a3038] dark:bg-[#111214] dark:text-zinc-300">
              {agent.description}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
