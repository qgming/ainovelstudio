import { ChevronRight, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { Button } from "../components/ui/button";
import { SettingSectionContent } from "../components/settings/SettingSectionContent";
import {
  getSettingNavItem,
  isSettingSectionKey,
  settingNavItems,
  type SettingSectionKey,
} from "../components/settings/settingNavigation";
import { useIsMobile } from "../hooks/use-mobile";
import { useThemeStore } from "../stores/themeStore";

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
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
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
    <aside className="w-full shrink-0 overflow-hidden border-b border-border bg-app lg:w-[240px] lg:border-r lg:border-b-0">
      <div>
        {settingNavItems.map(({ icon: Icon, key, title }) => {
          const isActive = activeSection === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={title}
              onClick={() => onSelect(key)}
              className={[
                "flex h-11 w-full items-center gap-3 border-b border-border px-3 text-left transition",
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              <span className="truncate text-[16px] font-medium leading-none tracking-[-0.03em]">{title}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function MobileSettingListPage() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <PageShell
      title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">设置</h1>}
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
    <PageShell
      title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">设置</h1>}
      contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
    >
      <div className="flex h-full min-h-0 flex-col gap-0 lg:flex-row">
        <DesktopSettingNav
          activeSection={desktopActiveSection}
          onSelect={(nextSection) => {
            setDesktopActiveSection(nextSection);
            if (sectionParam) {
              navigate(`/setting/${nextSection}`);
            }
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <SettingSectionContent sectionKey={desktopActiveSection} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
