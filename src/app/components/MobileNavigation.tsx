import { FileText, Settings, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@shared/utils";

type MobileNavItem = {
  end?: boolean;
  Icon: LucideIcon;
  label: string;
  to: string;
};

const mobileNavItems: MobileNavItem[] = [
  { to: "/", label: "首页", Icon: FileText, end: true },
  { to: "/skills", label: "技能", Icon: Sparkles },
  { to: "/leaderboard", label: "排行榜", Icon: Trophy },
  { to: "/setting", label: "设置", Icon: Settings },
];

export function MobileNavigation() {
  const location = useLocation();

  if (location.pathname.startsWith("/books/")) {
    return null;
  }

  return (
    <nav
      aria-label="主导航"
      className="shrink-0 border-t border-border bg-sidebar/95 px-2 backdrop-blur"
    >
      <div
        className="grid h-16 w-full gap-1"
        style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}
      >
        {mobileNavItems.map((item) => (
          <MobileNavigationLink key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}

function MobileNavigationLink({ to, label, Icon, end }: MobileNavItem) {
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
