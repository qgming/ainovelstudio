import { type ReactNode, useEffect, useState } from "react";
import { Download, GitBranch, Globe, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import appIcon from "../../assets/icon.png";
import packageJson from "../../../package.json";
import { normalizeVersionLabel } from "../../lib/update/version";
import type { UpdateSummary } from "../../lib/update/types";
import { useUpdateStore } from "../../stores/updateStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
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

function formatPublishedAt(value: string | null) {
  if (!value) {
    return "未提供";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getPackageLabel(packageKind: UpdateSummary["packageKind"]) {
  return packageKind === "apk" ? "APK" : "EXE";
}

export function AboutSection() {
  const autoUpdateEnabled = useUpdateStore((state) => state.autoUpdateEnabled);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const downloadAvailableUpdate = useUpdateStore((state) => state.downloadAvailableUpdate);
  const initializePreferences = useUpdateStore((state) => state.initializePreferences);
  const installDownloadedUpdate = useUpdateStore((state) => state.installDownloadedUpdate);
  const setAutoUpdateEnabled = useUpdateStore((state) => state.setAutoUpdateEnabled);
  const status = useUpdateStore((state) => state.status);
  const updateSummary = useUpdateStore((state) => state.updateSummary);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const isBusy = status === "checking" || status === "downloading" || status === "installing";

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
    if (status === "downloaded") {
      void installDownloadedUpdate();
      return;
    }

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
                  status === "available"
                    ? <Download className="h-4 w-4" />
                    : <RefreshCw className="h-4 w-4" />
                )}
                {status === "downloaded"
                  ? "立即安装"
                  : status === "available"
                    ? "查看更新"
                  : status === "checking"
                    ? "检查中..."
                    : status === "downloading"
                      ? "下载中..."
                      : status === "installing"
                        ? "安装中..."
                        : "检查更新"}
              </Button>
            </div>
          </section>

          <section className="px-4 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-[17px] font-medium tracking-[-0.03em] text-foreground">
                  自动更新
                </h3>
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
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {updateSummary ? `发现 ${normalizeVersionLabel(updateSummary.version)}` : "发现新版本"}
            </DialogTitle>
            <DialogDescription>
              当前版本 {normalizeVersionLabel(APP_VERSION)}
              {updateSummary ? `，发布时间 ${formatPublishedAt(updateSummary.publishedAt)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {updateSummary ? (
              <div className="rounded-[16px] border border-[#dbe3ee] bg-[#f8fafc] px-4 py-3 dark:border-[#2b313b] dark:bg-[#151a21]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0f172a] dark:text-zinc-100">
                      {normalizeVersionLabel(updateSummary.version)}
                    </p>
                    <p className="mt-1 text-xs text-[#64748b] dark:text-zinc-400">
                      安装包类型：{getPackageLabel(updateSummary.packageKind ?? null)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-sm font-medium text-[#0f172a] dark:text-zinc-100">更新日志</p>
              <div className="max-h-[280px] overflow-y-auto rounded-[16px] border border-[#dbe3ee] bg-white px-4 py-3 text-sm leading-6 text-[#334155] dark:border-[#2b313b] dark:bg-[#11151a] dark:text-zinc-300">
                {updateSummary?.notes?.trim() ? (
                  <pre className="whitespace-pre-wrap break-words font-sans">
                    {updateSummary.notes.trim()}
                  </pre>
                ) : (
                  <p>本次版本暂未提供更新日志。</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUpdateDialogOpen(false)}>
              稍后再说
            </Button>
            <Button type="button" onClick={handleDownloadAvailableUpdate}>
              下载更新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
