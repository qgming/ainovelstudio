export type ReleaseAssetSummary = {
  contentType: string;
  downloadUrl: string;
  name: string;
  size: number;
};

export type LatestReleaseInfo = {
  assets: ReleaseAssetSummary[];
  body: string;
  draft: boolean;
  htmlUrl: string;
  name: string;
  prerelease: boolean;
  publishedAt?: string | null;
  tagName: string;
};
