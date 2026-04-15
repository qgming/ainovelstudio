import { getBaseName } from "../../lib/bookWorkspace/paths";

type ContextItem = {
  description?: string;
  id: string;
  name: string;
};

type AgentContextOverviewProps = {
  activeFilePath: string | null;
  enabledAgents: ContextItem[];
  enabledSkills: ContextItem[];
  rootPath: string | null;
};

function EmptyState({ text }: { text: string }) {
  return <p className="px-3 py-2 text-sm leading-6 text-[#718096] dark:text-[#7f8a9b]">{text}</p>;
}

function SectionLabel({ title }: { title: string }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#66758a] dark:text-[#8b97a8]">
      {title}
    </p>
  );
}

function StaticMenuRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] px-3 py-2 text-sm text-[#111827] dark:text-[#eef2f7]">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[#7b8798] dark:text-[#8b97a8]">{label}</p>
      <p className="mt-1 break-all leading-6">{value}</p>
    </div>
  );
}

function ItemList({ items }: { items: ContextItem[] }) {
  if (items.length === 0) {
    return <EmptyState text="当前没有已启用内容。" />;
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-[10px] px-3 py-2 text-sm font-medium text-[#111827] dark:text-[#eef2f7]"
        >
          {item.name}
        </div>
      ))}
    </div>
  );
}

export function AgentContextOverview({
  activeFilePath,
  enabledAgents,
  enabledSkills,
  rootPath,
}: AgentContextOverviewProps) {
  const workspaceName = rootPath ? getBaseName(rootPath) : "未打开工作区";
  const workspaceId = rootPath ?? "未打开工作区";

  return (
    <div className="space-y-1">
      <SectionLabel title="工作区" />
      <div className="space-y-1">
        <StaticMenuRow label="名称" value={workspaceName} />
        <StaticMenuRow label="书库标识" value={workspaceId} />
        <StaticMenuRow label="当前文件" value={activeFilePath ?? "未选中文件"} />
      </div>
      <SectionLabel title={`启用技能 (${enabledSkills.length})`} />
      <div>
        <ItemList items={enabledSkills} />
      </div>
      <SectionLabel title={`启用子 Agent (${enabledAgents.length})`} />
      <div>
        <ItemList items={enabledAgents} />
      </div>
    </div>
  );
}
