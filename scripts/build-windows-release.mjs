import path from "node:path";
import { spawn } from "node:child_process";

const TAURI_CLI_ENTRY = path.join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");

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

await runCommand(process.execPath, [TAURI_CLI_ENTRY, "build", "--bundles", "nsis"], process.env);
await runCommand(process.execPath, ["scripts/collect-release-bundles.mjs", "windows"], process.env);
