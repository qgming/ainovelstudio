import { MonitorCog, MoonStar, Settings2 } from "lucide-react";
import { PageShell } from "../components/PageShell";
import { useThemeStore } from "../stores/themeStore";

const settingItems = [
  {
    title: "工作区偏好",
    description: "预留目录、默认模板与启动行为配置。",
    icon: MonitorCog,
  },
  {
    title: "应用设置",
    description: "后续可接入模型、同步与桌面行为等选项。",
    icon: Settings2,
  },
];

export function SettingPage() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <PageShell
      title="设置"
      description="主题状态已经提升为全局 store。这里和侧边栏都能控制同一份深色模式状态。"
    >
      <div className="max-w-4xl space-y-5">
        <section className="flex flex-col gap-5 rounded-[24px] border border-[#e6e7eb] bg-white p-7 shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:border-[#26272b] dark:bg-[#16171a] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ecf5ff] text-[#0b84e7] dark:bg-[#202227] dark:text-zinc-100">
              <MoonStar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">
                界面主题
              </h2>
              <p className="mt-2 text-sm leading-7 text-[#607089] dark:text-zinc-400">
                当前主题：{theme === "dark" ? "深色模式" : "浅色模式"}。任何组件都可以通过全局状态读取并切换主题。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-14 items-center justify-center rounded-[18px] border border-[#0b84e7] bg-[#0b84e7] px-6 text-base font-semibold text-white transition-colors hover:bg-[#0a74cb] dark:border-zinc-100 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
          >
            {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          </button>
        </section>

        {settingItems.map(({ title, description, icon: Icon }) => (
          <section
            key={title}
            className="rounded-[24px] border border-[#e6e7eb] bg-white p-7 shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:border-[#26272b] dark:bg-[#16171a]"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ecf5ff] text-[#0b84e7] dark:bg-[#202227] dark:text-zinc-100">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">
                  {title}
                </h2>
                <p className="mt-2 text-sm leading-7 text-[#607089] dark:text-zinc-400">
                  {description}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
