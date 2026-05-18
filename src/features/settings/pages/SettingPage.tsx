import { ChevronRight, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "@shared/components/PageShell";
import { Button } from "@shared/ui/button";
import { SettingSectionContent } from "@features/settings/components/SettingSectionContent";
import {
  getSettingNavItem,
  isSettingSectionKey,
  settingNavItems,
  type SettingSectionKey,
} from "@features/settings/components/settingNavigation";
import { useIsMobile } from "@shared/hooks/useMobile";
import { useThemeStore } from "@shared/theme/useThemeStore";

function DetailTitle({
  currentLabel,
  parentLabel,
  parentTo,
}: {
  currentLabel: string;
  parentLabel: string;
  parentTo: string;
}) {
  return (
    <div className="truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">
      <Link
        to={parentTo}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        {parentLabel}
      </Link>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>{currentLabel}</span>
    </div>
  );
}

function DesktopSettingNav({
  activeSection,
  onSelect,
}: {
  activeSection: SettingSectionKey;
  onSelect: (sectionKey: SettingSectionKey) => void;
}) {
  return (
    <aside className="flex h-full w-[252px] shrink-0 flex-col overflow-hidden bg-app">
      <div className="flex min-h-9 shrink-0 items-center px-4">
        <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">设置</h1>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="设置导航">
        {settingNavItems.map(({ icon: Icon, key, title }) => {
          const isActive = activeSection === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={title}
              onClick={() => onSelect(key)}
              className={[
                "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left transition",
                isActive
                  ? "bg-panel text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.045)] dark:shadow-none"
                  : "text-muted-foreground hover:bg-panel-subtle hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              <span className="truncate text-[16px] font-medium leading-none tracking-[-0.03em]">{title}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileSettingListPage() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <PageShell
      title={<h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">设置</h1>}
      contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
    >
      <div className="h-full min-h-0 overflow-y-auto bg-app">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4 text-foreground">
          <Palette className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[16px] font-medium tracking-[-0.03em]">主题</span>
          <Button
            type="button"
            aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            className="text-muted-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
        {settingNavItems.map(({ icon: Icon, key, title }) => (
          <Link
            key={key}
            to={`/setting/${key}`}
            aria-label={`进入${title}`}
            className="flex h-14 items-center gap-3 border-b border-border px-4 text-foreground transition hover:bg-accent/40"
          >
            <Icon className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[16px] font-medium tracking-[-0.03em]">{title}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </PageShell>
  );
}

function MobileSettingDetailPage({ sectionKey }: { sectionKey: SettingSectionKey }) {
  const currentItem = getSettingNavItem(sectionKey);

  return (
    <PageShell
      title={<DetailTitle currentLabel={currentItem.title} parentLabel="设置" parentTo="/setting" />}
      contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
    >
      <SettingSectionContent sectionKey={sectionKey} />
    </PageShell>
  );
}

export function SettingPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { sectionKey: sectionParam } = useParams<{ sectionKey?: string }>();
  const initialSection = isSettingSectionKey(sectionParam) ? sectionParam : "agents";
  const [desktopActiveSection, setDesktopActiveSection] = useState<SettingSectionKey>(initialSection);

  useEffect(() => {
    if (!isSettingSectionKey(sectionParam)) {
      if (!sectionParam) {
        setDesktopActiveSection("agents");
      }
      return;
    }

    setDesktopActiveSection(sectionParam);
  }, [sectionParam]);

  if (sectionParam && !isSettingSectionKey(sectionParam)) {
    return <Navigate replace to="/setting" />;
  }

  if (isMobile) {
    if (!sectionParam) {
      return <MobileSettingListPage />;
    }

    return <MobileSettingDetailPage sectionKey={initialSection} />;
  }

  return (
    <section className="editor-shell flex h-full min-h-0 overflow-hidden bg-app">
      <DesktopSettingNav
        activeSection={desktopActiveSection}
        onSelect={(nextSection) => {
          setDesktopActiveSection(nextSection);
          if (sectionParam) {
            navigate(`/setting/${nextSection}`);
          }
        }}
      />
      <main className="min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <SettingSectionContent sectionKey={desktopActiveSection} />
      </main>
    </section>
  );
}
