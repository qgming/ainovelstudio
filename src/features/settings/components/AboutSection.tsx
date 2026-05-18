import { type ReactNode, useEffect, useState } from "react";
import { Download, GitBranch, Globe, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import appIcon from "@/assets/icon.png";
import packageJson from "../../../../package.json";
import { normalizeVersionLabel } from "@features/update/lib/version";
import { useUpdateStore } from "@features/update/stores/useUpdateStore";
import { UpdateReleaseDialog } from "@features/update/components/UpdateReleaseDialog";
import { Switch } from "@shared/ui/switch";
import { SettingsActionLink, SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";

const APP_VERSION = packageJson.version;
const OFFICIAL_WEBSITE = "https://www.qgming.com";
const GITHUB_REPOSITORY = "https://github.com/qgming/ainovelstudio";

function ExternalLinkRow({
  actionLabel,
  href,
  icon,
  title,
}: {
  actionLabel: string;
  href: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-accent/35">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border/45 text-muted-foreground">
          {icon}
        </div>
        <p className="truncate text-[15px] font-medium text-foreground">
          {title}
        </p>
      </div>
      <SettingsActionLink
        href={href}
        target="_blank"
        rel="noreferrer"
        label={actionLabel}
        text={actionLabel}
        className="inline-flex shrink-0 items-center"
      />
    </div>
  );
}

function AboutCard({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      {children}
    </section>
  );
}

export function AboutSection() {
  const autoUpdateEnabled = useUpdateStore((state) => state.autoUpdateEnabled);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const downloadAvailableUpdate = useUpdateStore((state) => state.downloadAvailableUpdate);
  const initializePreferences = useUpdateStore((state) => state.initializePreferences);
  const setAutoUpdateEnabled = useUpdateStore((state) => state.setAutoUpdateEnabled);
  const status = useUpdateStore((state) => state.status);
  const updateSummary = useUpdateStore((state) => state.updateSummary);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const isBusy = status === "checking";

  useEffect(() => {
    initializePreferences();
  }, [initializePreferences]);

  useEffect(() => {
    if (status === "available" && updateSummary) {
      setUpdateDialogOpen(true);
      return;
    }

    if (status !== "available") {
      setUpdateDialogOpen(false);
    }
  }, [status, updateSummary]);

  function handleCheckButtonClick() {
    if (status === "available") {
      setUpdateDialogOpen(true);
      return;
    }

    toast("正在检查更新", {
      description: "正在连接更新源并检查最新版本。",
    });
    void checkForUpdates();
  }

  function handleDownloadAvailableUpdate() {
    void downloadAvailableUpdate();
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <div className="space-y-2">
          <AboutCard>
            <div className="px-3 pt-3 pb-4 sm:px-4 sm:pb-5">
              <div className="flex min-h-10 items-center justify-between gap-3 pb-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <h3 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">关于我们</h3>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                  <img
                    src={appIcon}
                    alt="神笔写作 Logo"
                    className="h-16 w-16 shrink-0 rounded-[16px] object-contain"
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 className="truncate text-[26px] font-semibold tracking-[-0.05em] text-foreground">
                        神笔写作
                      </h2>
                      <span className="inline-flex h-7 shrink-0 items-center rounded-[8px] border border-primary/25 bg-primary/8 px-2.5 text-sm font-medium text-primary">
                        {normalizeVersionLabel(APP_VERSION)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      AI 小说创作工作台
                    </p>
                  </div>
                </div>
                <SettingsHeaderResponsiveButton
                  type="button"
                  label={status === "available" ? "查看更新" : status === "checking" ? "检查中..." : "检查更新"}
                  text={status === "available" ? "查看更新" : status === "checking" ? "检查中..." : "检查更新"}
                  tone="primary"
                  disabled={isBusy}
                  onClick={handleCheckButtonClick}
                  icon={
                    isBusy ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : status === "available" ? (
                      <Download className="h-4 w-4" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )
                  }
                />
              </div>

              <div className="mt-5 flex min-h-10 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium tracking-[-0.02em] text-foreground">
                    自动更新
                  </p>
                </div>
                <Switch
                  checked={autoUpdateEnabled}
                  label="自动更新"
                  onChange={setAutoUpdateEnabled}
                />
              </div>
            </div>
          </AboutCard>

          <AboutCard>
            <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
              <div className="flex min-h-8 items-center gap-2 px-1">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <h3 className="truncate text-[17px] font-medium tracking-[-0.03em] text-foreground">相关入口</h3>
              </div>
              <ExternalLinkRow
                actionLabel="打开官网"
                href={OFFICIAL_WEBSITE}
                icon={<Globe className="h-4 w-4" />}
                title="官网"
              />
              <ExternalLinkRow
                actionLabel="查看 GitHub"
                href={GITHUB_REPOSITORY}
                icon={<GitBranch className="h-4 w-4" />}
                title="GitHub"
              />
            </div>
          </AboutCard>
        </div>
      </div>
      <UpdateReleaseDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        onDownload={handleDownloadAvailableUpdate}
        summary={updateSummary}
      />
    </section>
  );
}
