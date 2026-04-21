import { type ReactNode, useEffect } from "react";
import { GitBranch, Globe, Info, LoaderCircle, RefreshCw } from "lucide-react";
import appIcon from "../../assets/icon.png";
import packageJson from "../../../package.json";
import { normalizeVersionLabel } from "../../lib/update/version";
import { useUpdateStore } from "../../stores/updateStore";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

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
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center text-[#64748b] dark:text-zinc-400">
          {icon}
        </div>
        <p className="text-[15px] font-medium text-[#0f172a] dark:text-zinc-100">
          {title}
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 shrink-0 items-center rounded-[10px] border border-[#dbe3ee] px-3 text-sm font-medium text-[#0f172a] transition hover:border-[#cbd5e1] dark:border-[#2b313b] dark:text-zinc-100 dark:hover:border-[#334155]"
      >
        {actionLabel}
      </a>
    </div>
  );
}

function getUpdateStatusText({
  autoUpdateEnabled,
  pendingInstallVersion,
  progress,
  status,
  updateVersion,
}: {
  autoUpdateEnabled: boolean;
  pendingInstallVersion: string | null;
  progress: number | null;
  status: "idle" | "checking" | "downloading" | "downloaded" | "installing" | "latest" | "error";
  updateVersion: string | null;
}) {
  if (status === "downloading" && updateVersion) {
    const progressLabel = typeof progress === "number" ? ` ${progress}%` : "";
    return `正在后台下载 ${normalizeVersionLabel(updateVersion)}${progressLabel}`;
  }

  if (status === "downloaded" && pendingInstallVersion) {
    return `已下载 ${normalizeVersionLabel(pendingInstallVersion)}，下次打开应用时会继续安装。`;
  }

  if (status === "installing" && pendingInstallVersion) {
    return `正在准备安装 ${normalizeVersionLabel(pendingInstallVersion)}。`;
  }

  if (status === "latest") {
    return "当前版本已是最新。";
  }

  if (autoUpdateEnabled) {
    return "启动后会在后台检查并自动下载桌面端新版本。";
  }

  return "关闭后仅在手动检查更新时执行下载与安装。";
}

export function AboutSection() {
  const autoUpdateEnabled = useUpdateStore((state) => state.autoUpdateEnabled);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const initializePreferences = useUpdateStore((state) => state.initializePreferences);
  const installDownloadedUpdate = useUpdateStore((state) => state.installDownloadedUpdate);
  const pendingInstallVersion = useUpdateStore((state) => state.pendingInstallVersion);
  const progress = useUpdateStore((state) => state.progress);
  const setAutoUpdateEnabled = useUpdateStore((state) => state.setAutoUpdateEnabled);
  const status = useUpdateStore((state) => state.status);
  const updateSummary = useUpdateStore((state) => state.updateSummary);
  const isBusy = status === "checking" || status === "downloading" || status === "installing";
  const updateStatusText = getUpdateStatusText({
    autoUpdateEnabled,
    pendingInstallVersion,
    progress,
    status,
    updateVersion: updateSummary?.version ?? null,
  });

  useEffect(() => {
    initializePreferences();
  }, [initializePreferences]);

  function handleCheckButtonClick() {
    if (status === "downloaded") {
      void installDownloadedUpdate();
      return;
    }

    void checkForUpdates();
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader title="关于我们" icon={<Info className="h-4 w-4" />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="divide-y divide-border">
          <section className="px-4 py-5">
            <div className="flex items-center gap-4">
              <img
                src={appIcon}
                alt="神笔写作 Logo"
                className="h-14 w-14 shrink-0 rounded-[14px] object-contain"
              />
              <div className="min-w-0">
                <h2 className="truncate text-[21px] font-semibold tracking-[-0.04em] text-[#0f172a] dark:text-white">
                  神笔写作
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#64748b] dark:text-zinc-400">
                  AI 小说创作工作台
                </p>
              </div>
            </div>
          </section>

          <section className="px-4 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">版本</p>
                <p className="mt-2 text-[28px] font-semibold tracking-[-0.05em] text-[#0f172a] dark:text-white">
                  {normalizeVersionLabel(APP_VERSION)}
                </p>
              </div>
              <Button
                type="button"
                disabled={isBusy}
                onClick={handleCheckButtonClick}
              >
                {isBusy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {status === "downloaded"
                  ? "立即安装"
                  : status === "checking"
                    ? "检查中..."
                    : status === "downloading"
                      ? "下载中..."
                      : status === "installing"
                        ? "安装中..."
                        : "检查更新"}
              </Button>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {updateStatusText}
            </p>
          </section>

          <section className="px-4 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-[17px] font-medium tracking-[-0.03em] text-foreground">
                  自动更新
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  发现新版本后会在后台自动下载，下载完成后提示立即安装或稍后安装。
                </p>
              </div>
              <Switch
                checked={autoUpdateEnabled}
                label="自动更新"
                onChange={setAutoUpdateEnabled}
              />
            </div>
          </section>

          <section className="px-4 py-5">
            <p className="text-[17px] font-medium tracking-[-0.03em] text-foreground">
              联系方式
            </p>
            <div className="divide-y divide-border">
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
          </section>
        </div>
      </div>
    </section>
  );
}
