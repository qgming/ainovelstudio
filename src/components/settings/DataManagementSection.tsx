import { useEffect, useId, useRef, useState } from "react";
import { Cable, Download, LoaderCircle, RefreshCw, RotateCcw, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getDefaultDataSyncSettings,
  testDataSyncConnection,
  type DataSyncSettingsDocument,
} from "../../lib/dataManagement/api";
import { applyAppClientStateAndReload } from "../../lib/dataManagement/clientState";
import { useIsMobile } from "../../hooks/use-mobile";
import { useDataManagementStore } from "../../stores/dataManagementStore";
import { SettingsHeaderResponsiveButton, SettingsSectionHeader } from "./SettingsSectionHeader";

function isSameConfig(left: DataSyncSettingsDocument, right: DataSyncSettingsDocument) {
  return (
    left.enabled === right.enabled &&
    left.serverUrl === right.serverUrl &&
    left.remotePath === right.remotePath &&
    left.username === right.username &&
    left.password === right.password
  );
}

function SyncCard({
  config,
  errorMessage,
  onChange,
}: {
  config: DataSyncSettingsDocument;
  errorMessage: string | null;
  onChange: (patch: Partial<DataSyncSettingsDocument>) => void;
}) {
  const serverId = useId();
  const pathId = useId();
  const userId = useId();
  const passwordId = useId();
  const canSync = Boolean(config.serverUrl.trim());

  return (
    <section className="px-4 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h3 className="text-[17px] font-medium tracking-[-0.03em] text-foreground">云同步</h3>
        </div>
        {canSync ? <p className="text-sm leading-6 text-muted-foreground">已配置 WebDAV</p> : null}
      </div>

      <div className="mt-5 grid gap-x-4 gap-y-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={serverId}>WebDAV 地址</Label>
          <Input id={serverId} value={config.serverUrl} onChange={(event) => onChange({ serverUrl: event.target.value })} placeholder="https://dav.jianguoyun.com/dav/" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={pathId}>同步目录</Label>
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
    </section>
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
  const syncNow = useDataManagementStore((state) => state.syncNow);
  const [draft, setDraft] = useState(getDefaultDataSyncSettings());
  const [isDirty, setIsDirty] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canTestConnection = Boolean(draft.serverUrl.trim()) && !isTesting;
  const canSync = Boolean(draft.serverUrl.trim()) && !isDirty && status !== "syncing";
  const isSaving = status === "saving";

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
      toast.success("备份已导入", { description: "应用将刷新为导入后的完整数据。" });
      applyAppClientStateAndReload(result.clientState);
    } catch (error) {
      toast.error("导入失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "导入备份失败。",
      });
    }
  }

  async function handleSync() {
    try {
      const result = await syncNow();
      if (result.action === "downloaded" && result.clientState) {
        toast.success("云端数据已拉取", { description: "应用将刷新为云端最新数据。" });
        applyAppClientStateAndReload(result.clientState);
        return;
      }
      if (result.action === "uploaded") {
        toast.success("本地数据已推送到云端");
        return;
      }
      toast("本地与云端已一致");
    } catch (error) {
      toast.error("同步失败", {
        description: error instanceof Error && error.message.trim() ? error.message : "请先检查 WebDAV 配置。",
      });
    }
  }

  async function handleSaveConfig() {
    try {
      const saved = await saveConfig(draft);
      setDraft(saved);
      setIsDirty(false);
      toast.success("云同步配置已保存");
    } catch (error) {
      toast.error("保存失败", {
        description:
          error instanceof Error && error.message.trim() ? error.message : "保存云同步配置失败。",
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
      <SettingsSectionHeader
        title="数据管理"
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
            <SettingsHeaderResponsiveButton
              type="button"
              label={status === "syncing" ? "同步中..." : "立即同步"}
              disabled={!canSync}
              size={isMobile ? "icon-sm" : "sm"}
              text="立即同步"
              icon={status === "syncing" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void handleSync()}
            />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="divide-y divide-border">
          <SyncCard
            config={draft}
            errorMessage={errorMessage}
            onChange={(patch) => {
              setDraft((current) => {
                const next = { ...current, ...patch };
                setIsDirty(!isSameConfig(next, config));
                return next;
              });
            }}
          />
          <section className="px-4 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h3 className="text-[17px] font-medium tracking-[-0.03em] text-foreground">本地备份</h3>
              </div>
              <div className="flex flex-nowrap gap-3">
                <Button type="button" onClick={() => void handleExport()} disabled={status === "syncing"}>
                  <Download className="h-4 w-4" />
                  导出数据
                </Button>
                <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={status === "syncing"}>
                  <Upload className="h-4 w-4" />
                  导入数据
                </Button>
              </div>
            </div>
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
          </section>
        </div>
      </div>
    </section>
  );
}
