import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_SIGNING_KEY_PATH = path.join(os.homedir(), ".tauri", "ainovelstudio.key");
const TAURI_CLI_ENTRY = path.join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");

function resolveEnvironment() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    return normalizeEnvironment({
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
        process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    });
  }

  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    return buildSigningEnvironment(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
  }

  if (existsSync(DEFAULT_SIGNING_KEY_PATH)) {
    return buildSigningEnvironment(DEFAULT_SIGNING_KEY_PATH);
  }

  throw new Error(
    `未找到 updater 签名私钥。请设置 TAURI_SIGNING_PRIVATE_KEY 或 TAURI_SIGNING_PRIVATE_KEY_PATH，默认期望路径为 ${DEFAULT_SIGNING_KEY_PATH}`,
  );
}

function normalizeEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter((entry) => typeof entry[1] === "string"),
  );
}

function buildSigningEnvironment(privateKeyPath) {
  return normalizeEnvironment({
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(privateKeyPath, "utf8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  });
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} 失败，退出码 ${code ?? "null"}。`));
    });
  });
}

const buildEnvironment = resolveEnvironment();

await runCommand(process.execPath, [TAURI_CLI_ENTRY, "build", "--bundles", "nsis"], buildEnvironment);
await runCommand(process.execPath, ["scripts/collect-release-bundles.mjs", "windows"], process.env);
