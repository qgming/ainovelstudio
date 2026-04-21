import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const RELEASE_DIR = "release-packages";
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

  const targetPath = path.join(
    projectRoot,
    RELEASE_DIR,
    `ainovelstudio_${version}_${WINDOWS_PLATFORM}_${WINDOWS_ARCH}.exe`,
  );
  await rm(targetPath, { force: true });
  await copyFile(sourcePath, targetPath);
  return targetPath;
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
    const collectedPath = await collectWindowsBundle(projectRoot, version);
    console.log(`Collected Windows bundle: ${collectedPath}`);
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
