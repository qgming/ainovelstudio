import { FileText, Settings, Sun, Moon, Sparkles, Users, GitBranch, type LucideIcon } from "lucide-react";
import { NavLink, useLocation, useMatch, useResolvedPath } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "../hooks/use-mobile";
import { useThemeStore } from "../stores/themeStore";

type NavItem = {
  to: string;
  label: string;
  Icon: LucideIcon;
  end?: boolean;
};

const DESKTOP_SIDEBAR_ICON_CLASS = "size-5";

const primaryItems: NavItem[] = [
  { to: "/", label: "首页", Icon: FileText, end: true },
  { to: "/workflows", label: "工作流", Icon: GitBranch },
  { to: "/skills", label: "技能", Icon: Sparkles },
  { to: "/agents", label: "代理", Icon: Users },
];

const secondaryItems: NavItem[] = [{ to: "/setting", label: "设置", Icon: Settings }];

function DesktopSidebarLink({ to, label, Icon, end }: NavItem) {
  const resolvedPath = useResolvedPath(to);
  const isActive = useMatch({ path: resolvedPath.pathname, end: end ?? false }) !== null;

  // 桌面端导航项：保持极简的左侧 indicator + 居中图标
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          end={end}
          aria-label={label}
          className={cn(
            "group relative flex h-11 w-full items-center justify-center px-0 text-muted-foreground transition-colors duration-150 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-current before:opacity-0 before:transition-opacity before:content-['']",
            isActive
              ? "text-primary before:opacity-100"
              : "hover:text-foreground",
          )}
        >
          <Icon className={DESKTOP_SIDEBAR_ICON_CLASS} strokeWidth={2.1} />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function MobileNavLink({ to, label, Icon, end }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          "flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition-colors duration-150",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={2.1} />
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const shouldHideMobileNav =
    location.pathname.startsWith("/books/") || location.pathname.startsWith("/workflows/");

  if (isMobile && shouldHideMobileNav) {
    return null;
  }

  if (isMobile) {
    const mobileItemCount = primaryItems.length + secondaryItems.length;

    return (
      <nav
        aria-label="主导航"
        className="shrink-0 border-t border-border bg-sidebar/95 px-2 backdrop-blur"
      >
        <div
          className="grid h-16 w-full gap-1"
          style={{ gridTemplateColumns: `repeat(${mobileItemCount}, minmax(0, 1fr))` }}
        >
          {primaryItems.map((item) => (
            <MobileNavLink key={item.to} {...item} />
          ))}
          {secondaryItems.map((item) => (
            <MobileNavLink key={item.to} {...item} />
          ))}
        </div>
      </nav>
    );
  }

  return (
    <aside className="flex h-full w-11 shrink-0 flex-col items-center justify-between overflow-hidden border-r border-border bg-sidebar py-2">
      <nav aria-label="主导航" className="flex w-full flex-col gap-1.5">
        {primaryItems.map((item) => (
          <DesktopSidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="flex w-full flex-col items-stretch gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-label="主题切换"
              variant="ghost"
              onClick={toggleTheme}
              className="h-11 w-full rounded-none px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className={DESKTOP_SIDEBAR_ICON_CLASS} strokeWidth={2.1} />
              ) : (
                <Moon className={DESKTOP_SIDEBAR_ICON_CLASS} strokeWidth={2.1} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}</TooltipContent>
        </Tooltip>
        <nav aria-label="辅助导航" className="flex w-full flex-col gap-1.5">
          {secondaryItems.map((item) => (
            <DesktopSidebarLink key={item.to} {...item} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
