import { Plus, Upload } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { SkillCard } from "../components/skills/SkillCard";
import { useSkillsStore } from "../stores/skillsStore";
import { useNavigate } from "react-router-dom";

export function SkillsPage() {
  const navigate = useNavigate();
  const builtinSkills = useSkillsStore((state) => state.builtinSkills);
  const importedSkills = useSkillsStore((state) => state.importedSkills);
  const toggleSkill = useSkillsStore((state) => state.toggleSkill);

  const skills = [...builtinSkills, ...importedSkills];

  return (
    <PageShell
      title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">技能中心</h1>}
      actions={[
        { icon: Upload, label: "导入技能", tone: "default" },
        { icon: Plus, label: "新建技能", tone: "primary" },
      ]}
    >
      <div className="h-full overflow-y-auto">
        {skills.length > 0 ? (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7 dark:border-[#20242b]">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onOpen={() => navigate(`/skills/${skill.id}`)}
                onToggle={() => toggleSkill(skill.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[240px] items-center justify-center border-t border-[#e2e8f0] px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:text-zinc-400">
            暂无可用技能。
          </div>
        )}
      </div>
    </PageShell>
  );
}
