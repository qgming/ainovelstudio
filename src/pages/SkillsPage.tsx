import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { SkillCard } from "../components/skills/SkillCard";
import { useSkillsStore } from "../stores/skillsStore";

function SkillSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-[10px] border border-[#e2e8f0] bg-[#fbfbfc] dark:border-[#20242b] dark:bg-[#15171b]">
      <div className="border-b border-[#e2e8f0] px-4 py-2 dark:border-[#20242b]">
        <h2 className="text-sm font-semibold text-[#111827] dark:text-zinc-100">{title}</h2>
      </div>
      <div className="divide-y divide-[#e2e8f0] dark:divide-[#20242b]">{children}</div>
    </section>
  );
}

export function SkillsPage() {
  const builtinSkills = useSkillsStore((state) => state.builtinSkills);
  const importedSkills = useSkillsStore((state) => state.importedSkills);
  const toggleSkill = useSkillsStore((state) => state.toggleSkill);
  const enabledCount = [...builtinSkills, ...importedSkills].filter((skill) => skill.enabled).length;

  return (
    <PageShell
      title="技能中心"
      description={`已启用 ${enabledCount} 个技能。启用后的技能会作为结构化上下文注入右侧 Agent 工作台。`}
      actions={[{ icon: Plus, label: "导入技能", tone: "default" }]}
    >
      <div className="h-full overflow-y-auto pr-1">
        <div className="max-w-4xl space-y-3 pb-6">
          <SkillSection title={`内置技能 · 已启用 ${builtinSkills.filter((skill) => skill.enabled).length}`}>
            {builtinSkills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={() => toggleSkill(skill.id)} />
            ))}
          </SkillSection>

          <SkillSection title={`导入技能 · 已启用 ${importedSkills.filter((skill) => skill.enabled).length}`}>
            {importedSkills.length > 0 ? (
              importedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onToggle={() => toggleSkill(skill.id)} />
              ))
            ) : (
              <div className="px-4 py-4 text-xs leading-5 text-[#64748b] dark:text-zinc-400">
                暂无导入技能。
              </div>
            )}
          </SkillSection>
        </div>
      </div>
    </PageShell>
  );
}
