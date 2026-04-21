import { openUrl } from "@tauri-apps/plugin-opener";
import { type ReactNode, useState } from "react";
import { Download, GitBranch, Globe, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import appIcon from "../../assets/icon.png";
import packageJson from "../../../package.json";
import { fetchLatestReleaseInfo } from "../../lib/update/api";
import type { LatestReleaseInfo } from "../../lib/update/types";
import {
  compareVersions,
  getPreferredReleaseAsset,
  normalizeVersionLabel,
} from "../../lib/update/version";
import { Button } from "../ui/button";
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

export function AboutSection() {
  const [isChecking, setIsChecking] = useState(false);
  const [latestRelease, setLatestRelease] = useState<LatestReleaseInfo | null>(
    null,
  );
  const preferredAsset = latestRelease
    ? getPreferredReleaseAsset(latestRelease)
    : null;
  const latestVersionLabel = latestRelease
    ? normalizeVersionLabel(latestRelease.tagName)
    : "";

  async function handleCheckUpdates() {
    setIsChecking(true);

    try {
      const release = await fetchLatestReleaseInfo();
      const hasNewVersion = compareVersions(release.tagName, APP_VERSION) > 0;
      setLatestRelease(hasNewVersion ? release : null);

      if (hasNewVersion) {
        toast("发现新版本", {
          description: `${latestVersionLabel || normalizeVersionLabel(release.tagName)} 已可下载。`,
        });
        return;
      }

      toast.success("当前已是最新版本", {
        description: `当前版本 ${APP_VERSION}`,
      });
    } catch (error) {
      toast.error("检查更新失败", {
        description:
          error instanceof Error && error.message.trim()
            ? error.message
            : "请稍后重试。",
      });
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <SettingsSectionHeader title="关于我们" icon={<Info className="h-4 w-4" />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-5">
          <div className="space-y-4">
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

            <div className="border-t border-[#e2e8f0] dark:border-[#20242b]" />

            <div className="flex flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[17px] font-medium tracking-[-0.03em] text-foreground">
                  当前版本
                </p>
                <p className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-[#0f172a] dark:text-white">
                  {normalizeVersionLabel(APP_VERSION)}
                </p>
              </div>
              <Button
                type="button"
                disabled={isChecking}
                onClick={() => void handleCheckUpdates()}
              >
                {isChecking ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isChecking ? "检查中..." : "检查更新"}
              </Button>
            </div>
          </div>
        </div>

        {latestRelease ? (
          <>
            <div className="border-t border-[#e2e8f0] dark:border-[#20242b]" />
            <div className="px-4 py-5">
              <p className="text-[17px] font-medium tracking-[-0.03em] text-foreground">
                最新版本
              </p>
              <h3 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#0f172a] dark:text-white">
                {latestRelease.name || latestVersionLabel}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#64748b] dark:text-zinc-400">
                版本 {latestVersionLabel}
                {latestRelease.publishedAt
                  ? ` · 发布于 ${new Date(
                      latestRelease.publishedAt,
                    ).toLocaleDateString("zh-CN")}`
                  : ""}
              </p>

              {latestRelease.body.trim() ? (
                <>
                  <div className="mt-4 border-t border-[#e2e8f0] dark:border-[#20242b]" />
                  <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-[#334155] dark:text-zinc-300">
                    {latestRelease.body}
                  </pre>
                </>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                {preferredAsset ? (
                  <Button
                    type="button"
                    onClick={() => void openUrl(preferredAsset.downloadUrl)}
                  >
                    <Download className="h-4 w-4" />
                    下载更新
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void openUrl(latestRelease.htmlUrl)}
                >
                  查看 Release
                </Button>
              </div>
            </div>
          </>
        ) : null}

        <div className="border-t border-[#e2e8f0] dark:border-[#20242b]" />

        <div className="px-4 py-5">
          <p className="text-[17px] font-medium tracking-[-0.03em] text-foreground">
            联系方式
          </p>
          <div className="divide-y divide-[#e2e8f0] dark:divide-[#20242b]">
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
        </div>
      </div>
    </section>
  );
}
