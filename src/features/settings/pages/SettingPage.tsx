import { ChevronRight, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "@shared/components/PageShell";
import { SegmentedControl } from "@shared/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { SettingSectionContent } from "@features/settings/components/SettingSectionContent";
import {
  getSettingNavItem,
  isSettingSectionKey,
  settingNavItems,
  type SettingSectionKey,
} from "@features/settings/components/settingNavigation";
import { useIsMobile } from "@shared/hooks/useMobile";
import { useThemeStore, type ThemePreference } from "@shared/theme/useThemeStore";

const themeOptions = [
  { value: "system", label: "跟随", ariaLabel: "跟随系统主题", icon: <Monitor className="h-3.5 w-3.5" /> },
  { value: "light", label: "浅色", ariaLabel: "使用浅色模式", icon: <Sun className="h-3.5 w-3.5" /> },
  { value: "dark", label: "深色", ariaLabel: "使用深色模式", icon: <Moon className="h-3.5 w-3.5" /> },
] as const;

const mobileSettingNavItems = settingNavItems.filter((item) => item.key !== "debug");

const themePreferenceMeta: Record<ThemePreference, { icon: typeof Monitor; label: string; menuLabel: string }> = {
  system: { icon: Monitor, label: "跟随系统", menuLabel: "跟随系统" },
  light: { icon: Sun, label: "浅色模式", menuLabel: "浅色模式" },
  dark: { icon: Moon, label: "深色模式", menuLabel: "深色模式" },
};

function ThemePreferenceControl({ compact = false }: { compact?: boolean }) {
  const themePreference = useThemeStore((state) => state.themePreference);
  const setThemePreference = useThemeStore((state) => state.setThemePreference);

  return (
    <SegmentedControl<ThemePreference>
      ariaLabel="主题模式"
      buttonClassName={compact ? "h-7 px-2" : "h-8 px-2.5"}
      className={compact ? "w-auto flex-nowrap rounded-lg p-0.5" : "max-w-full flex-nowrap"}
      onValueChange={setThemePreference}
      options={themeOptions}
      value={themePreference}
    />
  );
}

function ThemePreferenceStatus({ themePreference }: { themePreference: ThemePreference }) {
  const meta = themePreferenceMeta[themePreference];
  const Icon = meta.icon;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

function MobileSettingCardContent({
  icon,
  right,
  title,
}: {
  icon: React.ReactNode;
  right?: React.ReactNode;
  title: string;
}) {
  return (
    <>
      <span className="flex h-9 w-6 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">
        {title}
      </span>
      {right}
    </>
  );
}

function MobileThemeCard() {
  const themePreference = useThemeStore((state) => state.themePreference);
  const setThemePreference = useThemeStore((state) => state.setThemePreference);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`主题模式：${themePreferenceMeta[themePreference].label}`}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border/45 bg-card px-4 py-2 text-left text-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] transition-colors hover:border-border/70 hover:bg-card dark:bg-panel dark:shadow-none"
        >
          <MobileSettingCardContent
            icon={<Palette className="h-4.5 w-4.5" />}
            title="主题"
            right={(
              <span className="min-w-0 shrink-0">
                <ThemePreferenceStatus themePreference={themePreference} />
              </span>
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-44">
        <DropdownMenuRadioGroup
          value={themePreference}
          onValueChange={(value) => setThemePreference(value as ThemePreference)}
        >
          {themeOptions.map((option) => {
            const meta = themePreferenceMeta[option.value];
            const Icon = meta.icon;

            return (
              <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-2 py-2">
                <Icon className="h-4 w-4" />
                <span>{meta.menuLabel}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileSettingLinkCard({
  icon,
  title,
  to,
}: {
  icon: React.ReactNode;
  title: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      aria-label={`进入${title}`}
      className="flex min-h-12 items-center gap-3 rounded-2xl border border-border/45 bg-card px-4 py-2 text-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] transition-colors hover:border-border/70 hover:bg-card dark:bg-panel dark:shadow-none"
    >
      <MobileSettingCardContent
        icon={icon}
        title={title}
        right={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      />
    </Link>
  );
}

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
      <div className="shrink-0 border-t border-border px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Palette className="h-3.5 w-3.5" />
          <span>主题</span>
        </div>
        <ThemePreferenceControl compact />
      </div>
    </aside>
  );
}

function MobileSettingListPage() {
  return (
    <PageShell
      title={<h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">设置</h1>}
      contentClassName="min-h-0 flex-1 overflow-hidden px-0 py-0"
    >
      <div className="h-full min-h-0 overflow-y-auto bg-app px-3 py-3">
        <div className="grid gap-2 pb-4">
          <MobileThemeCard />
        {mobileSettingNavItems.map(({ icon: Icon, key, title }) => (
          <MobileSettingLinkCard
            key={key}
            to={`/setting/${key}`}
            title={title}
            icon={<Icon className="h-4.5 w-4.5" />}
          />
        ))}
        </div>
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
