import { invoke } from "@tauri-apps/api/core";
import type { ClientStateSnapshot } from "./clientState";

export type DataSyncSettingsDocument = {
  enabled: boolean;
  password: string;
  remotePath: string;
  serverUrl: string;
  username: string;
};

export type BackupRestoreResult = {
  clientState: ClientStateSnapshot;
  restoredAt: number;
};

export type CloudBackupUploadResult = {
  localUpdatedAt: number;
  remoteUpdatedAt?: number | null;
};

export type DataSyncProbeResult = {
  ok: boolean;
  message: string;
};

export function getDefaultDataSyncSettings(): DataSyncSettingsDocument {
  return {
    enabled: false,
    password: "",
    remotePath: "ainovelstudio",
    serverUrl: "",
    username: "",
  };
}

export function readDataSyncSettings() {
  return invoke<DataSyncSettingsDocument>("read_data_sync_settings");
}

export function writeDataSyncSettings(settings: DataSyncSettingsDocument) {
  return invoke<DataSyncSettingsDocument>("write_data_sync_settings", { settings });
}

export function testDataSyncConnection(settings: DataSyncSettingsDocument) {
  return invoke<DataSyncProbeResult>("test_data_sync_connection", { settings });
}

export function exportAppDataBackup(clientState: ClientStateSnapshot) {
  return invoke<string | null>("export_app_data_backup", { clientState });
}

export function importAppDataBackup(fileName: string, archiveBytes: number[]) {
  return invoke<BackupRestoreResult>("import_app_data_backup", { archiveBytes, fileName });
}

export function uploadAppDataBackupViaWebdav(clientState: ClientStateSnapshot) {
  return invoke<CloudBackupUploadResult>("upload_app_data_backup_via_webdav", { clientState });
}

export function downloadAppDataBackupViaWebdav() {
  return invoke<BackupRestoreResult>("download_app_data_backup_via_webdav");
}
