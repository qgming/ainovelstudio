import { FileText, Settings, Sparkles, Sun, Moon, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useThemeStore } from "../stores/themeStore";

const topItems = [
  { to: "/", label: "首页", Icon: FileText, end: true },
  { to: "/skills", label: "技能", Icon: Sparkles },
  { to: "/agents", label: "代理", Icon: Users },
];

const bottomItems = [{ to: "/setting", label: "设置", Icon: Settings }];

function SidebarLink({ to, label, Icon, end }: (typeof topItems)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        [
          "flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors duration-200",
          isActive
            ? "bg-[#0b84e7] text-white dark:bg-zinc-100 dark:text-black"
            : "text-[#111827] hover:bg-[#edf1f6] dark:text-zinc-300 dark:hover:bg-[#1a1c21]",
        ].join(" ")
      }
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={2.1} />
    </NavLink>
  );
}

export function Sidebar() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <aside className="flex h-full w-[56px] shrink-0 flex-col items-center justify-between overflow-hidden border-r border-[#e8eaee] bg-[#f7f7f8] py-3 dark:border-[#23252b] dark:bg-[#111214]">
      <nav className="flex flex-col gap-2">
        {topItems.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          aria-label="主题切换"
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded-[10px] px-0 text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
        >
          {theme === "dark" ? (
            <Sun className="h-[22px] w-[22px]" strokeWidth={2.1} />
          ) : (
            <Moon className="h-[22px] w-[22px]" strokeWidth={2.1} />
          )}
        </button>
        <nav className="flex flex-col gap-2">
          {bottomItems.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
