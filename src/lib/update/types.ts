export type UpdatePackageKind = "exe" | "apk";

export type UpdateSummary = {
  currentVersion: string;
  version: string;
  notes: string;
  publishedAt: string | null;
  downloadUrl?: string | null;
  packageKind?: UpdatePackageKind | null;
};
