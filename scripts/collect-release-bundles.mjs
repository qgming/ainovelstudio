import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_DIR = "release-packages";
const GITHUB_OWNER = "qgming";
const GITHUB_REPO = "ainovelstudio";
const WINDOWS_PLATFORM = "windows";
const WINDOWS_ARCH = "x64";
const ANDROID_PLATFORM = "android";
const ANDROID_ARCH = "arm64";
const MANIFEST_FILE_NAME = "app.json";

async function readVersion(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return packageJson.version;
}

async function listFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name));
}

async function findNewestFile(filePaths) {
  const withStats = await Promise.all(
    filePaths.map(async (filePath) => ({
      filePath,
      stats: await stat(filePath),
    })),
  );

  withStats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  return withStats[0]?.filePath ?? null;
}

async function readExistingManifest(projectRoot, version) {
  const manifestPath = path.join(projectRoot, RELEASE_DIR, MANIFEST_FILE_NAME);
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.version === version) {
      return manifest;
    }
  } catch {
    // Missing or stale manifests are replaced below.
  }

  return {
    version,
    notes: "",
    publishedAt: new Date().toISOString().slice(0, 10),
    downloads: {},
  };
}

async function writeManifest(projectRoot, version, target, download) {
  const manifestPath = path.join(projectRoot, RELEASE_DIR, MANIFEST_FILE_NAME);
  const manifest = await readExistingManifest(projectRoot, version);
  manifest.downloads = {
    ...(manifest.downloads ?? {}),
    [target]: download,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function buildGitHubReleaseDownloadUrl(version, fileName) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${fileName}`;
}

async function collectWindowsBundle(projectRoot, version) {
  const sourceDir = path.join(
    projectRoot,
    "src-tauri",
    "target",
    "release",
    "bundle",
    "nsis",
  );
  const files = await listFiles(sourceDir);
  const candidates = files.filter(
    (filePath) =>
      filePath.endsWith(".exe") &&
      path.basename(filePath).includes(version),
  );
  const sourcePath = await findNewestFile(candidates);

  if (!sourcePath) {
    throw new Error(`未找到版本 ${version} 的 Windows 安装包。`);
  }

  const targetPath = path.join(
    projectRoot,
    RELEASE_DIR,
    `ainovelstudio_${version}_${WINDOWS_PLATFORM}_${WINDOWS_ARCH}.exe`,
  );
  const latestTargetPath = path.join(
    projectRoot,
    RELEASE_DIR,
    `ainovelstudio_${WINDOWS_PLATFORM}_${WINDOWS_ARCH}.exe`,
  );

  await rm(targetPath, { force: true });
  await rm(latestTargetPath, { force: true });
  await copyFile(sourcePath, targetPath);
  await copyFile(sourcePath, latestTargetPath);
  const manifestPath = await writeManifest(projectRoot, version, "windows-x64", {
    packageKind: "exe",
    url: buildGitHubReleaseDownloadUrl(version, path.basename(targetPath)),
  });
  return {
    latestTargetPath,
    manifestPath,
    targetPath,
  };
}

async function collectAndroidBundle(projectRoot, version) {
  const sourceDir = path.join(
    projectRoot,
    "src-tauri",
    "gen",
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    ANDROID_ARCH,
    "release",
  );
  const files = await listFiles(sourceDir);
  const candidates = files.filter(
    (filePath) =>
      filePath.endsWith(".apk") &&
      !path.basename(filePath).includes("unaligned"),
  );
  const sourcePath = await findNewestFile(candidates);

  if (!sourcePath) {
    throw new Error("未找到 Android APK 安装包。");
  }

  const targetPath = path.join(
    projectRoot,
    RELEASE_DIR,
    `ainovelstudio_${version}_${ANDROID_PLATFORM}_${ANDROID_ARCH}.apk`,
  );
  const latestTargetPath = path.join(
    projectRoot,
    RELEASE_DIR,
    `ainovelstudio_${ANDROID_PLATFORM}_${ANDROID_ARCH}.apk`,
  );
  await rm(targetPath, { force: true });
  await rm(latestTargetPath, { force: true });
  await copyFile(sourcePath, targetPath);
  await copyFile(sourcePath, latestTargetPath);
  const manifestPath = await writeManifest(projectRoot, version, "android-arm64", {
    packageKind: "apk",
    url: buildGitHubReleaseDownloadUrl(version, path.basename(targetPath)),
  });
  return { latestTargetPath, manifestPath, targetPath };
}

async function main() {
  const platform = process.argv[2];
  const projectRoot = process.cwd();
  const version = await readVersion(projectRoot);

  if (!platform) {
    throw new Error("请传入平台参数：windows 或 android。");
  }

  await mkdir(path.join(projectRoot, RELEASE_DIR), { recursive: true });

  if (platform === "windows") {
    const collected = await collectWindowsBundle(projectRoot, version);
    console.log(`Collected Windows bundle: ${collected.targetPath}`);
    console.log(`Collected Windows latest bundle: ${collected.latestTargetPath}`);
    console.log(`Generated update manifest: ${collected.manifestPath}`);
    return;
  }

  if (platform === "android") {
    const collectedPath = await collectAndroidBundle(projectRoot, version);
    console.log(`Collected Android bundle: ${collectedPath.targetPath}`);
    console.log(`Collected Android latest bundle: ${collectedPath.latestTargetPath}`);
    console.log(`Generated update manifest: ${collectedPath.manifestPath}`);
    return;
  }

  throw new Error(`不支持的平台参数：${platform}`);
}

await main();
