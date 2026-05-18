import { Copy, FileText, Minus, Moon, Settings, Sparkles, Square, Sun, Trophy, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NavLink, useMatch, useResolvedPath } from "react-router-dom";
import appIcon from "@/assets/icon.png";
import { cn } from "@shared/utils";
import { useThemeStore } from "@shared/theme/useThemeStore";

type TitleNavItem = {
  end?: boolean;
  Icon: LucideIcon;
  label: string;
  to: string;
};

const titleNavItems: TitleNavItem[] = [
  { to: "/", label: "书架", Icon: FileText, end: true },
  { to: "/skills", label: "技能", Icon: Sparkles },
  { to: "/leaderboard", label: "排行榜", Icon: Trophy },
];

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function syncMaximizedState() {
      const maximized = await appWindow.isMaximized();
      if (mounted) {
        setIsMaximized(maximized);
      }
    }

    void syncMaximizedState();

    const unlistenPromise = appWindow.onResized(async () => {
      const maximized = await appWindow.isMaximized();
      if (mounted) {
        setIsMaximized(maximized);
      }
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleToggleMaximize() {
    if (isMaximized) {
      await appWindow.unmaximize();
      setIsMaximized(false);
      return;
    }

    await appWindow.maximize();
    setIsMaximized(true);
  }

  async function handleCloseWindow() {
    await invoke("terminate_application");
  }

  return (
    <header className="flex h-11 shrink-0 items-center justify-between bg-panel-subtle px-1">
      <div
        data-tauri-drag-region
        className="flex h-full shrink-0 items-center gap-2 overflow-hidden pl-2 pr-2 select-none"
      >
        <img src={appIcon} alt="神笔写作图标" className="h-4 w-4 shrink-0 rounded-sm" />
        <span className="truncate text-[12px] font-medium tracking-[0.02em] text-muted-foreground">
          神笔写作
        </span>
      </div>

      <nav aria-label="主导航" className="hidden h-full shrink-0 items-center gap-1.5 px-1 md:flex">
        {titleNavItems.map((item) => (
          <TitleNavLink key={item.to} {...item} />
        ))}
      </nav>

      <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />

      <div className="flex h-full shrink-0 items-center gap-1.5 pr-0.5">
        <TitleIconButton ariaLabel="主题切换" onClick={toggleTheme}>
          {theme === "dark" ? (
            <Sun className="h-4 w-4" strokeWidth={2.1} />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={2.1} />
          )}
        </TitleIconButton>
        <TitleUtilityLink to="/setting" label="设置" Icon={Settings} />
        <WindowButton ariaLabel="最小化窗口" onClick={() => void appWindow.minimize()}>
          <Minus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </WindowButton>
        <WindowButton
          ariaLabel={isMaximized ? "还原窗口" : "最大化窗口"}
          onClick={() => void handleToggleMaximize()}
        >
          {isMaximized ? (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.1} />
          ) : (
            <Square className="h-3.5 w-3.5" strokeWidth={2.1} />
          )}
        </WindowButton>
        <WindowButton
          ariaLabel="关闭窗口"
          danger
          onClick={() => void handleCloseWindow()}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
        </WindowButton>
      </div>
    </header>
  );
}

function TitleNavLink({ to, label, Icon, end }: TitleNavItem) {
  const resolvedPath = useResolvedPath(to);
  const isActive = useMatch({ path: resolvedPath.pathname, end: end ?? false }) !== null;

  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-medium transition-colors",
        isActive
          ? "border-border/55 bg-card text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border/45 hover:bg-card hover:text-foreground dark:hover:bg-panel",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
      <span>{label}</span>
    </NavLink>
  );
}

function TitleUtilityLink({ to, label, Icon }: Omit<TitleNavItem, "end">) {
  const resolvedPath = useResolvedPath(to);
  const isExactActive = useMatch({ path: resolvedPath.pathname, end: true }) !== null;
  const isChildActive = useMatch({ path: `${resolvedPath.pathname}/*`, end: false }) !== null;
  const isActive = isExactActive || isChildActive;

  return (
    <NavLink
      to={to}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors",
        isActive
          ? "border-border/55 bg-card text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border/45 hover:bg-card hover:text-foreground dark:hover:bg-panel",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.1} />
    </NavLink>
  );
}

type TitleIconButtonProps = {
  ariaLabel: string;
  children: ReactNode;
  onClick: () => void;
};

function TitleIconButton({ ariaLabel, children, onClick }: TitleIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent bg-transparent text-muted-foreground transition-colors hover:border-border/45 hover:bg-card hover:text-foreground dark:hover:bg-panel"
    >
      {children}
    </button>
  );
}

type WindowButtonProps = {
  ariaLabel: string;
  children: ReactNode;
  danger?: boolean;
  onClick: () => void;
};

function WindowButton({ ariaLabel, children, danger = false, onClick }: WindowButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={
        ariaLabel === "最小化窗口"
          ? "最小化窗口 — 将应用收起到任务栏"
          : ariaLabel === "最大化窗口"
            ? "最大化窗口 — 让应用占满当前屏幕"
            : ariaLabel === "还原窗口"
              ? "还原窗口 — 恢复到非最大化尺寸"
              : "关闭窗口 — 退出应用"
      }
      onClick={onClick}
      className={[
        "flex h-8 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors duration-150",
        danger
          ? "hover:bg-destructive hover:text-white"
          : "hover:border-border/45 hover:bg-card hover:text-foreground dark:hover:bg-panel",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
