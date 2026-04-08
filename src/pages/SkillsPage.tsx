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
      <div className="h-full overflow-y-auto pr-1">
        {skills.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 pb-6">
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
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-[16px] border border-dashed border-[#d7dde8] bg-[#fbfbfc] px-6 text-sm text-[#64748b] dark:border-[#2a3038] dark:bg-[#15171b] dark:text-zinc-400">
            暂无可用技能。
          </div>
        )}
      </div>
    </PageShell>
  );
}
