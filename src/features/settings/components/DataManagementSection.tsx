import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Cable, CloudUpload, Download, HardDriveDownload, LoaderCircle, RotateCcw, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@shared/ui/alert-dialog";
import {
  getDefaultDataSyncSettings,
  testDataSyncConnection,
  type DataSyncSettingsDocument,
} from "@features/settings/data-sync/dataSyncApi";
import { applyAppClientStateAndReload } from "@features/settings/data-sync/clientState";
import { useIsMobile } from "@shared/hooks/useMobile";
import { useDataManagementStore } from "@features/settings/stores/useDataManagementStore";
import { SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";

function isSameConfig(left: DataSyncSettingsDocument, right: DataSyncSettingsDocument) {
  return (
    left.enabled === right.enabled &&
    left.serverUrl === right.serverUrl &&
    left.remotePath === right.remotePath &&
    left.username === right.username &&
    left.password === right.password
  );
}

function DataManagementPanelSection({
  actions,
  children,
  icon,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  const hasBody = children !== undefined && children !== null;

  return (
    <section className="overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      <div className={`flex min-h-10 flex-col gap-3 px-3 pt-3 ${hasBody ? "pb-1" : "pb-3"} sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 text-muted-foreground">{icon}</span>
          <h3 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">{title}</h3>
        </div>
        {actions ? <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">{actions}</div> : null}
      </div>
      {children ? children : null}
    </section>
  );
}

function SyncCard({
  canOperateCloudBackup,
  config,
  downloading,
  errorMessage,
  onChange,
  onDownload,
  onUpload,
  uploading,
}: {
  canOperateCloudBackup: boolean;
  config: DataSyncSettingsDocument;
  downloading: boolean;
  errorMessage: string | null;
  onChange: (patch: Partial<DataSyncSettingsDocument>) => void;
  onDownload: () => void;
  onUpload: () => void;
  uploading: boolean;
}) {
  const serverId = useId();
  const pathId = useId();
  const userId = useId();
  const passwordId = useId();

  return (
    <div className="px-4 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5">
      <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={serverId}>WebDAV 地址</Label>
          <Input id={serverId} value={config.serverUrl} onChange={(event) => onChange({ serverUrl: event.target.value })} placeholder="https://dav.jianguoyun.com/dav/" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={pathId}>云备份目录</Label>
          <Input id={pathId} value={config.remotePath} onChange={(event) => onChange({ remotePath: event.target.value })} placeholder="ainovelstudio" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={userId}>用户名</Label>
          <Input id={userId} value={config.username} onChange={(event) => onChange({ username: event.target.value })} placeholder="WebDAV 用户名" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={passwordId}>密码</Label>
          <Input id={passwordId} type="password" value={config.password} onChange={(event) => onChange({ password: event.target.value })} placeholder="WebDAV 密码" />
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 border-t border-[#f1d5d8] pt-3 text-xs leading-6 text-[#b42318] dark:border-[#44242a] dark:text-[#ffb4ab]">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-1.5">
        <SettingsHeaderResponsiveButton
          type="button"
          label={uploading ? "上传中..." : "上传云备份"}
          text={uploading ? "上传中..." : "上传云备份"}
          disabled={!canOperateCloudBackup}
          icon={uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          onClick={onUpload}
        />
        <SettingsHeaderResponsiveButton
          type="button"
          label={downloading ? "下载中..." : "下载云备份"}
          text={downloading ? "下载中..." : "下载云备份"}
          tone="primary"
          disabled={!canOperateCloudBackup}
          icon={downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          onClick={onDownload}
        />
      </div>
    </div>
  );
}

export function DataManagementSection() {
  const isMobile = useIsMobile();
  const config = useDataManagementStore((state) => state.config);
  const errorMessage = useDataManagementStore((state) => state.errorMessage);
  const exportBackup = useDataManagementStore((state) => state.exportBackup);
  const importBackup = useDataManagementStore((state) => state.importBackup);
  const initialize = useDataManagementStore((state) => state.initialize);
  const saveConfig = useDataManagementStore((state) => state.saveConfig);
  const status = useDataManagementStore((state) => state.status);
  const uploadCloudBackup = useDataManagementStore((state) => state.uploadCloudBackup);
  const downloadCloudBackup = useDataManagementStore((state) => state.downloadCloudBackup);
  const [draft, setDraft] = useState(getDefaultDataSyncSettings());
  const [isDirty, setIsDirty] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [cloudAction, setCloudAction] = useState<"upload" | "download" | null>(null);
  const [downloadConfirmOpen, setDownloadConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canTestConnection = Boolean(draft.serverUrl.trim()) && !isTesting;
  const isSaving = status === "saving";
  const isMutating = status === "loading" || status === "saving" || status === "syncing";
  const canOperateCloudBackup = Boolean(draft.serverUrl.trim()) && !isDirty && !isMutating;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    setDraft(config);
    setIsDirty(false);
  }, [config]);

  async function handleExport() {
    try {
      const savedPath = await exportBackup();
      if (savedPath) {
        toast.success("备份已导出", { description: savedPath });
      }
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "导出备份失败。",
      });
    }
  }

  async function handleImport(file: File) {
    try {
      const archiveBytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await importBackup(file.name, archiveBytes);
      toast.success("备份已导入", {
        description: "应用将刷新为导入后的完整数据，模型配置也会一并恢复。",
      });
      applyAppClientStateAndReload(result.clientState);
    } catch (error) {
      toast.error("导入失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "导入备份失败。",
      });
    }
  }

  async function handleUploadCloudBackup() {
    try {
      setCloudAction("upload");
      await uploadCloudBackup();
      toast.success("云备份已上传", { description: "当前本地数据已经写入 WebDAV。" });
    } catch (error) {
      toast.error("上传失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "请先检查 WebDAV 配置。",
      });
    } finally {
      setCloudAction(null);
    }
  }

  async function handleDownloadCloudBackup() {
    try {
      setCloudAction("download");
      const result = await downloadCloudBackup();
      setDownloadConfirmOpen(false);
      toast.success("云备份已下载", {
        description: "应用将刷新为云端备份内容，模型配置也会一并恢复。",
      });
      applyAppClientStateAndReload(result.clientState);
    } catch (error) {
      toast.error("下载失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "请先检查 WebDAV 配置。",
      });
    } finally {
      setCloudAction(null);
    }
  }

  async function handleSaveConfig() {
    try {
      const saved = await saveConfig(draft);
      setDraft(saved);
      setIsDirty(false);
      toast.success("云备份配置已保存");
    } catch (error) {
      toast.error("保存失败", {
        description:
          error instanceof Error && error.message.trim() ? error.message : "保存云备份配置失败。",
      });
    }
  }

  async function handleTestConnection() {
    if (!canTestConnection) {
      return;
    }

    setIsTesting(true);
    try {
      const result = await testDataSyncConnection(draft);
      if (result.ok) {
        toast.success("测试成功", { description: result.message });
        return;
      }
      toast.error("测试失败", { description: result.message });
    } catch (error) {
      toast.error("测试失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "请先检查 WebDAV 配置。",
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <div className="space-y-2">
          <DataManagementPanelSection
            title="云备份"
            icon={<CloudUpload className="h-4 w-4" />}
            actions={
              <>
                <SettingsHeaderResponsiveButton
                  type="button"
                  label={isSaving ? "保存中..." : "保存"}
                  disabled={!isDirty || isSaving}
                  size={isMobile ? "icon-sm" : "sm"}
                  text="保存"
                  icon={isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  onClick={() => void handleSaveConfig()}
                />
                <SettingsHeaderResponsiveButton
                  type="button"
                  label="重置"
                  size={isMobile ? "icon-sm" : "sm"}
                  text="重置"
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  onClick={() => {
                    const next = getDefaultDataSyncSettings();
                    setDraft(next);
                    setIsDirty(!isSameConfig(next, config));
                  }}
                />
                <SettingsHeaderResponsiveButton
                  type="button"
                  label={isTesting ? "测试中..." : "测试链接"}
                  disabled={!canTestConnection}
                  size={isMobile ? "icon-sm" : "sm"}
                  text="测试链接"
                  icon={isTesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Cable className="h-3.5 w-3.5" />}
                  onClick={() => void handleTestConnection()}
                />
              </>
            }
          >
            <SyncCard
              canOperateCloudBackup={canOperateCloudBackup}
              config={draft}
              downloading={cloudAction === "download"}
              errorMessage={errorMessage}
              onChange={(patch) => {
                setDraft((current) => {
                  const next = { ...current, ...patch };
                  setIsDirty(!isSameConfig(next, config));
                  return next;
                });
              }}
              onDownload={() => setDownloadConfirmOpen(true)}
              onUpload={() => void handleUploadCloudBackup()}
              uploading={cloudAction === "upload"}
            />
          </DataManagementPanelSection>

          <DataManagementPanelSection
            title="本地备份"
            icon={<HardDriveDownload className="h-4 w-4" />}
            actions={
              <>
                <SettingsHeaderResponsiveButton
                  type="button"
                  label="导出数据"
                  text="导出数据"
                  tone="primary"
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => void handleExport()}
                  disabled={isMutating}
                />
                <SettingsHeaderResponsiveButton
                  type="button"
                  label="导入数据"
                  text="导入数据"
                  icon={<Upload className="h-3.5 w-3.5" />}
                  onClick={() => inputRef.current?.click()}
                  disabled={isMutating}
                />
              </>
            }
          />
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              event.currentTarget.value = "";
              void handleImport(file);
            }}
          />
        </div>
      </div>
      <AlertDialog
        open={downloadConfirmOpen}
        onOpenChange={(open) => {
          if (!cloudAction) {
            setDownloadConfirmOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>下载云备份</AlertDialogTitle>
            <AlertDialogDescription>
              下载后会用云端备份覆盖当前本地数据，包括模型配置与页面偏好，并在完成后刷新应用。请确认本地数据已经完成备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cloudAction === "download"}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cloudAction === "download"}
              onClick={(event) => {
                event.preventDefault();
                void handleDownloadCloudBackup();
              }}
            >
              {cloudAction === "download" ? "下载中..." : "覆盖并下载"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
