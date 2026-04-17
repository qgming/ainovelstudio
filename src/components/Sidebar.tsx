import { FileText, Settings, Sparkles, Sun, Moon, Users, GitBranch } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useThemeStore } from "../stores/themeStore";

const topItems = [
  { to: "/", label: "首页", Icon: FileText, end: true },
  { to: "/workflows", label: "工作流", Icon: GitBranch },
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
        cn(
          "group relative flex h-11 w-full items-center justify-center px-0 text-muted-foreground transition-colors duration-150",
          isActive
            ? "text-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-current before:content-['']"
            : "hover:text-foreground",
        )
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
    <aside className="flex h-full w-11 shrink-0 flex-col items-center justify-between overflow-hidden border-r border-border bg-sidebar py-2">
      <nav className="flex w-full flex-col gap-1.5">
        {topItems.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="flex w-full flex-col items-stretch gap-2">
        <button
          type="button"
          aria-label="主题切换"
          onClick={toggleTheme}
          className="flex h-11 w-full items-center justify-center px-0 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="h-[22px] w-[22px]" strokeWidth={2.1} />
          ) : (
            <Moon className="h-[22px] w-[22px]" strokeWidth={2.1} />
          )}
        </button>
        <nav className="flex w-full flex-col gap-1.5">
          {bottomItems.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
