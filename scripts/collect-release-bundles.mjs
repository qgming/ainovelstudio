import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_DIR = "release-packages";
const GITHUB_OWNER = "qgming";
const GITHUB_REPO = "ainovelstudio";
const WINDOWS_PLATFORM = "windows";
const WINDOWS_ARCH = "x64";
const ANDROID_PLATFORM = "android";
const ANDROID_ARCH = "arm64";

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

  const sourceSignaturePath = `${sourcePath}.sig`;
  const signature = (await readFile(sourceSignaturePath, "utf8")).trim();

  const targetPath = path.join(
    projectRoot,
    RELEASE_DIR,
    `ainovelstudio_${version}_${WINDOWS_PLATFORM}_${WINDOWS_ARCH}.exe`,
  );
  const targetSignaturePath = `${targetPath}.sig`;
  const latestJsonPath = path.join(projectRoot, RELEASE_DIR, "latest.json");
  const releaseTag = `v${version}`;
  const updateUrl =
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}` +
    `/releases/download/${releaseTag}/${path.basename(targetPath)}`;
  const latestJson = {
    version,
    notes: "",
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: updateUrl,
      },
    },
  };

  await rm(targetPath, { force: true });
  await rm(targetSignaturePath, { force: true });
  await copyFile(sourcePath, targetPath);
  await copyFile(sourceSignaturePath, targetSignaturePath);
  await writeFile(latestJsonPath, JSON.stringify(latestJson, null, 2));
  return {
    latestJsonPath,
    targetPath,
    targetSignaturePath,
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
  await rm(targetPath, { force: true });
  await copyFile(sourcePath, targetPath);
  return targetPath;
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
    console.log(`Collected Windows signature: ${collected.targetSignaturePath}`);
    console.log(`Generated updater manifest: ${collected.latestJsonPath}`);
    return;
  }

  if (platform === "android") {
    const collectedPath = await collectAndroidBundle(projectRoot, version);
    console.log(`Collected Android bundle: ${collectedPath}`);
    return;
  }

  throw new Error(`不支持的平台参数：${platform}`);
}

await main();
