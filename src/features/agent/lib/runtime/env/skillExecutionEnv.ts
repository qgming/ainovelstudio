// pi loadSkills 的 skills 目录 FileSystem 适配器（CP-E）。
//
// pi 的 loadSkills(env, dirs) 通过 ExecutionEnv 遍历目录读取 SKILL.md。
// 本适配器把它用到的 FileSystem 方法（fileInfo/listDir/readTextFile/canonicalPath/
// absolutePath/joinPath）转发到 skill_fs_* 命令，根为 app_data_dir/skills/。
// 路径相对 skills_root，cwd 为空串。遵循 pi 契约：绝不抛错，失败编码进 Result。
//
// 与书内容 env(tauriExecutionEnv) / 会话 env(sessionExecutionEnv) 区别：
// 那两个分别锁 books/<id>/ 与 .sessions/；本适配器锁 app_data_dir/skills/，专供 loadSkills。

import type { ExecutionEnv, ExecutionEnvExecOptions, FileInfo } from "@earendil-works/pi-agent-core";
import { ExecutionError, FileError, err, ok } from "@earendil-works/pi-agent-core";
import { skillFsFileInfo, skillFsListDir, skillFsRead } from "@features/skills/api/skillApi";

function toFileError(error: unknown, path?: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  const code: FileError["code"] = /不存在|not found/i.test(message) ? "not_found" : "unknown";
  return new FileError(code, message, path);
}

/** 规范化为 skills_root 相对路径：统一正斜杠，去前导 ./ 与首尾斜杠。空串=skills 根。 */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * 创建指向 app_data_dir/skills/ 的 ExecutionEnv，供 pi loadSkills 遍历技能目录。
 * 只实现 loadSkills 实际用到的方法；其余文件方法返回 not_supported，shell 返回 unavailable。
 */
export function createSkillExecutionEnv(): ExecutionEnv {
  const unsupported = (method: string) =>
    err<void, FileError>(new FileError("not_supported", `技能目录不支持 ${method}。`));

  const env: ExecutionEnv = {
    cwd: "",

    async absolutePath(path) {
      return ok(normalize(path));
    },

    async canonicalPath(path) {
      return ok(normalize(path));
    },

    async joinPath(parts) {
      return ok(parts.map((part) => normalize(part)).filter(Boolean).join("/"));
    },

    async readTextFile(path) {
      try {
        return ok(await skillFsRead(normalize(path)));
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async readTextLines(path, opts) {
      try {
        const text = await skillFsRead(normalize(path));
        let lines = text.split(/\r\n|\n/);
        if (opts?.maxLines !== undefined) {
          lines = lines.slice(0, opts.maxLines);
        }
        return ok(lines);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async readBinaryFile(path) {
      try {
        return ok(new TextEncoder().encode(await skillFsRead(normalize(path))));
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async fileInfo(path) {
      try {
        const normalized = normalize(path);
        const info = await skillFsFileInfo(normalized);
        if (!info) {
          return err(new FileError("not_found", "技能路径不存在。", normalized));
        }
        const name = normalized.split("/").filter(Boolean).pop() ?? "";
        return ok<FileInfo, FileError>({
          kind: info.kind,
          mtimeMs: 0,
          name,
          path: normalized,
          size: info.size,
        });
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async listDir(path) {
      try {
        const base = normalize(path);
        const entries = await skillFsListDir(base);
        const infos = entries.map<FileInfo>((entry) => ({
          kind: entry.isDir ? "directory" : "file",
          mtimeMs: 0,
          name: entry.name,
          path: base ? `${base}/${entry.name}` : entry.name,
          size: entry.size,
        }));
        return ok(infos);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async exists(path) {
      try {
        return ok((await skillFsFileInfo(normalize(path))) !== null);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    // —— 以下为 loadSkills 不需要的写/删能力：技能由管理 UI 经 skillApi 维护，env 只读。 ——
    async writeFile() {
      return unsupported("写入");
    },
    async appendFile() {
      return unsupported("追加");
    },
    async createDir() {
      return unsupported("建目录");
    },
    async remove() {
      return unsupported("删除");
    },
    async createTempDir() {
      return err<string, FileError>(new FileError("not_supported", "技能目录不支持临时目录。"));
    },
    async createTempFile() {
      return err<string, FileError>(new FileError("not_supported", "技能目录不支持临时文件。"));
    },
    async cleanup() {
      // 无资源需释放。
    },

    async exec(_command: string, _options?: ExecutionEnvExecOptions) {
      return err(new ExecutionError("shell_unavailable", "技能目录不支持执行 shell 命令。"));
    },
  };

  return env;
}
