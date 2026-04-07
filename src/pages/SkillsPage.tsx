import { Plus, Sparkles, WandSparkles } from "lucide-react";
import { PageShell } from "../components/PageShell";

const skillBlocks = [
  {
    title: "世界观生成",
    description: "规划背景设定、阵营冲突与长期主线。",
    icon: Sparkles,
  },
  {
    title: "章节编排",
    description: "拆分剧情节奏、冲突点和章节摘要。",
    icon: WandSparkles,
  },
];

export function SkillsPage() {
  return (
    <PageShell
      title="技能中心"
      description="技能页继续沿用全局壳层。后续可以在这里承接技能市场、技能启停和工作流组合。"
      actions={[{ icon: Plus, label: "新增技能", tone: "primary" }]}
    >
      <div className="grid max-w-5xl gap-5 xl:grid-cols-2">
        {skillBlocks.map(({ title, description, icon: Icon }) => (
          <article
            key={title}
            className="rounded-[24px] border border-[#e6e7eb] bg-white p-7 shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:border-[#26272b] dark:bg-[#16171a]"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ecf5ff] text-[#0b84e7] dark:bg-[#202227] dark:text-zinc-100">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="mt-6 text-2xl font-bold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">
              {title}
            </h2>
            <p className="mt-3 text-sm leading-7 text-[#607089] dark:text-zinc-400">
              {description}
            </p>
          </article>
        ))}
      </div>
    </PageShell>
  );
}
