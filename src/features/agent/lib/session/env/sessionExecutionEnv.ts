// pi JsonlSessionRepo 的会话 FileSystem 适配器（per-book .sessions/ 后端）。
//
// CP-C 起，AI 会话由 pi AgentHarness 持久化。pi 的 JsonlSessionRepo 只要求一个
// FileSystem 子集（cwd/absolutePath/joinPath/readTextFile/readTextLines/writeFile/
// appendFile/listDir/exists/createDir/remove），本适配器把这些转发到 session_fs_* 命令，
// 真实落盘在 <book_id>/.sessions/ 下。
//
// 与书内容用的 tauriExecutionEnv 区别：那个锁在用户可见的书目录、拒绝保留名；
// 本适配器专供会话 JSONL，根就是 .sessions/，路径相对它，cwd 为空串。
// 所有方法遵循 pi 契约：绝不抛错，失败编码进返回的 Result。

import type { FileInfo, FileSystem } from "@earendil-works/pi-agent-core";
import { FileError, err, ok } from "@earendil-works/pi-agent-core";
import {
  sessionFsAppend,
  sessionFsCreateDir,
  sessionFsExists,
  sessionFsListDir,
  sessionFsRead,
  sessionFsRemove,
  sessionFsWrite,
} from "@features/books/api/bookWorkspaceApi";

// JsonlSessionRepo 实际使用的 FileSystem 子集（见 pi jsonl-repo.d.ts）。
export type SessionFileSystem = Pick<
  FileSystem,
  | "cwd"
  | "absolutePath"
  | "joinPath"
  | "readTextFile"
  | "readTextLines"
  | "writeFile"
  | "appendFile"
  | "listDir"
  | "exists"
  | "createDir"
  | "remove"
>;

function toFileError(error: unknown, path?: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  const code: FileError["code"] = /不存在|not found/i.test(message) ? "not_found" : "unknown";
  return new FileError(code, message, path);
}

/** 规范化会话路径：统一正斜杠，去前导 ./ 与首尾斜杠。空串表示 .sessions 根。 */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export type SessionExecutionEnvOptions = {
  /** 解析用：书籍标识（UUID），传给 session_fs_* 命令定位 per-book .sessions/。 */
  bookId: string;
};

/**
 * 创建绑定到单本书 .sessions/ 的会话 FileSystem，注入 pi JsonlSessionRepo。
 * cwd 与 sessionsRoot 都用空串（根即 .sessions/），pi 传入的相对路径直接落该目录。
 */
export function createSessionFileSystem(options: SessionExecutionEnvOptions): SessionFileSystem {
  const { bookId } = options;

  const fs: SessionFileSystem = {
    cwd: "",

    async absolutePath(path) {
      return ok(normalize(path));
    },

    async joinPath(parts) {
      const joined = parts.map((part) => normalize(part)).filter(Boolean).join("/");
      return ok(joined);
    },

    async readTextFile(path) {
      try {
        return ok(await sessionFsRead(bookId, normalize(path)));
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async readTextLines(path, opts) {
      try {
        const text = await sessionFsRead(bookId, normalize(path));
        let lines = text.split(/\r\n|\n/);
        if (opts?.maxLines !== undefined) {
          lines = lines.slice(0, opts.maxLines);
        }
        return ok(lines);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async writeFile(path, content) {
      try {
        const text = typeof content === "string" ? content : new TextDecoder().decode(content);
        await sessionFsWrite(bookId, normalize(path), text);
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async appendFile(path, content) {
      try {
        const text = typeof content === "string" ? content : new TextDecoder().decode(content);
        await sessionFsAppend(bookId, normalize(path), text);
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async listDir(path) {
      try {
        const entries = await sessionFsListDir(bookId, normalize(path));
        const base = normalize(path);
        const infos = entries.map<FileInfo>((entry) => ({
          kind: entry.isDir ? "directory" : "file",
          mtimeMs: 0,
          name: entry.name,
          path: base ? `${base}/${entry.name}` : entry.name,
          size: 0,
        }));
        return ok(infos);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async exists(path) {
      try {
        return ok(await sessionFsExists(bookId, normalize(path)));
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async createDir(path) {
      try {
        await sessionFsCreateDir(bookId, normalize(path));
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },

    async remove(path) {
      try {
        await sessionFsRemove(bookId, normalize(path));
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, normalize(path)));
      }
    },
  };

  return fs;
}
