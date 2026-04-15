import { Minus, Copy, Square, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "../assets/icon.png";

export function TitleBar() {
  const appWindow = getCurrentWindow();
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
    <header className="flex h-9 shrink-0 items-center justify-between border-b border-border-strong bg-panel-subtle pl-3">
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden select-none"
      >
        <img src={appIcon} alt="神笔写作图标" className="h-4 w-4 shrink-0 rounded-sm" />
        <span className="truncate text-[12px] font-medium tracking-[0.02em] text-muted-foreground">
          神笔写作
        </span>
      </div>

      <div className="flex h-full items-stretch">
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
      onClick={onClick}
      className={[
        "flex w-10 items-center justify-center text-muted-foreground transition-colors duration-150",
        danger
          ? "hover:bg-[#ef4444] hover:text-white"
          : "hover:bg-accent hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
