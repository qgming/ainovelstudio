import { Check } from "lucide-react";

type ResourceItem = {
  description?: string;
  id: string;
  kind: "agent" | "skill";
  name: string;
};

type AgentManualResourcePickerProps = {
  items: ResourceItem[];
  selectedIds: string[];
  onToggle: (item: ResourceItem) => void;
};

function EmptyState() {
  return <p className="px-1 py-2 text-sm text-[#718096] dark:text-[#7f8a9b]">当前没有已启用的技能或子 Agent。</p>;
}

function Section({ items, onToggle, selectedIds, title }: AgentManualResourcePickerProps & { title: string }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2 border-t border-[#e8edf4] pt-3 first:border-t-0 first:pt-0 dark:border-[#232833]">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#66758a] dark:text-[#8b97a8]">{title}</h3>
      <div className="divide-y divide-[#e8edf4] dark:divide-[#232833]">
        {items.map((item) => {
          const isSelected = selectedIds.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item)}
              className="flex w-full items-start justify-between gap-3 py-2 text-left transition hover:text-black dark:hover:text-white"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#111827] dark:text-[#eef2f7]">{item.name}</p>
              </div>
              <span
                className={[
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  isSelected
                    ? "border-[#111827] bg-[#111827] text-white dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827]"
                    : "border-[#cfd8e3] text-transparent dark:border-[#39424f]",
                ].join(" ")}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function AgentManualResourcePicker({ items, selectedIds, onToggle }: AgentManualResourcePickerProps) {
  const skills = items.filter((item) => item.kind === "skill");
  const agents = items.filter((item) => item.kind === "agent");

  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3 p-1">
      <Section items={skills} onToggle={onToggle} selectedIds={selectedIds} title={`技能 (${skills.length})`} />
      <Section items={agents} onToggle={onToggle} selectedIds={selectedIds} title={`子 Agent (${agents.length})`} />
    </div>
  );
}
