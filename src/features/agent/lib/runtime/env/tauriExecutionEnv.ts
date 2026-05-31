// pi-agent-core ExecutionEnv 的 Tauri 适配器。
//
// 把 pi 的 FileSystem + Shell 能力映射到本项目的书籍工作区（真实文件，经 Tauri command）。
// 一个适配器实例绑定一本书的工作区根（虚拟路径 books/<书名>），cwd 即该根。
// 所有方法遵循 pi 契约：绝不抛错，失败编码进返回的 Result。
//
// 说明：本项目工作区是「真实文件 + per-book 索引」，没有真实 shell，
// 因此 exec 返回 not_supported；检索能力由领域工具 workspace_search 提供，不走 shell。

import type {
  ExecutionEnv,
  ExecutionEnvExecOptions,
  FileInfo,
} from "@earendil-works/pi-agent-core";
import {
  ExecutionError,
  FileError,
  err,
  ok,
} from "@earendil-works/pi-agent-core";
import {
  createWorkspaceDirectory,
  deleteWorkspaceEntry,
  readWorkspaceTextFile,
  readWorkspaceTree,
  writeWorkspaceTextFile,
} from "@features/books/api/bookWorkspaceApi";
import type { TreeNode } from "@features/books/types";

/** 把任意未知错误转成稳定的 FileError；按错误文案粗分类。 */
function toFileError(error: unknown, path?: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  let code: FileError["code"] = "unknown";
  if (/不存在|not found/i.test(message)) {
    code = "not_found";
  } else if (/已存在|已被|already exists/i.test(message)) {
    code = "invalid";
  } else if (/不在当前书籍目录内|内部保留|越界/i.test(message)) {
    code = "permission_denied";
  } else if (/只能|不能/i.test(message)) {
    code = "invalid";
  }
  return new FileError(code, message, path);
}

/** 规范化路径：去掉前导 ./ 与多余斜杠，统一用 /。空串表示书根。 */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

/** 在目录树里按相对路径查找节点。 */
function findNode(tree: TreeNode, relativePath: string): TreeNode | null {
  const normalized = normalize(relativePath);
  if (normalized === "" || normalized === ".") {
    return tree;
  }
  const segments = normalized.split("/").filter(Boolean);
  let current: TreeNode | undefined = tree;
  for (const segment of segments) {
    current = current?.children?.find((child) => child.name === segment);
    if (!current) {
      return null;
    }
  }
  return current ?? null;
}

function nodeKind(node: TreeNode): FileInfo["kind"] {
  return node.kind === "directory" ? "directory" : "file";
}

export type TauriExecutionEnvOptions = {
  /** 解析用：书籍标识（UUID），传给 bookWorkspaceApi 的第一个参数。 */
  bookId: string;
  /** 展示用：书籍工作区虚拟根路径（books/<书名>），用作 cwd 与路径前缀解析。 */
  displayPath: string;
};

/**
 * 创建绑定到单本书工作区的 ExecutionEnv。
 * cwd = displayPath；传入方法的相对/绝对路径都解析到该书目录内（books/<书名>/...），
 * 而所有 bookWorkspaceApi 调用以 bookId 作为解析 key。
 */
export function createTauriExecutionEnv(options: TauriExecutionEnvOptions): ExecutionEnv {
  const { bookId, displayPath } = options;

  /** 把入参路径解析为传给 Tauri command 的「书内显示路径」（displayPath/相对）。 */
  function resolve(path: string): string {
    const normalized = normalize(path);
    if (normalized === "" || normalized === ".") {
      return displayPath;
    }
    if (normalized === displayPath || normalized.startsWith(`${displayPath}/`)) {
      return normalized;
    }
    return `${displayPath}/${normalized}`;
  }

  /** 拆出相对于书根的相对路径，用于 create/rename 的 parentPath/name 计算。 */
  function relativeOf(path: string): string {
    const resolved = resolve(path);
    if (resolved === displayPath) {
      return "";
    }
    return resolved.slice(displayPath.length + 1);
  }

  async function loadTree(): Promise<TreeNode> {
    return readWorkspaceTree(bookId);
  }

  const env: ExecutionEnv = {
    cwd: displayPath,

    async absolutePath(path) {
      return ok(resolve(path));
    },

    async joinPath(parts) {
      const joined = parts.map((part) => normalize(part)).filter(Boolean).join("/");
      return ok(joined);
    },

    async readTextFile(path) {
      try {
        const text = await readWorkspaceTextFile(bookId, resolve(path));
        return ok(text);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async readTextLines(path, opts) {
      try {
        const text = await readWorkspaceTextFile(bookId, resolve(path));
        let lines = text.split(/\r\n|\n/);
        if (opts?.maxLines !== undefined) {
          lines = lines.slice(0, opts.maxLines);
        }
        return ok(lines);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async readBinaryFile(path) {
      // 工作区文本工具不暴露二进制读取；按 UTF-8 文本回退。
      try {
        const text = await readWorkspaceTextFile(bookId, resolve(path));
        return ok(new TextEncoder().encode(text));
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async writeFile(path, content) {
      try {
        const text =
          typeof content === "string" ? content : new TextDecoder().decode(content);
        await writeWorkspaceTextFile(bookId, resolve(path), text);
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async appendFile(path, content) {
      // 书籍工作区无后端原生 append 命令(仅 .sessions 有 session_fs_append),这里以
      // 读-改-写模拟。注意两点局限:(1)工作区本就是 UTF-8 文本存储,读出会按 UTF-8 归一化,
      // 故非 UTF-8 原文件会被重写为 UTF-8(与 writeFile 行为一致,非本方法独有);(2)非原子,
      // 并发 append 同一文件会后写覆盖先写。当前应用工具不经由本方法 append 书籍文件,
      // 若未来需要高频/并发 append,应新增后端 append_text_file 命令替代此实现。
      try {
        const existing = await readWorkspaceTextFile(bookId, resolve(path)).catch(() => "");
        const addition =
          typeof content === "string" ? content : new TextDecoder().decode(content);
        await writeWorkspaceTextFile(bookId, resolve(path), existing + addition);
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async fileInfo(path) {
      try {
        const tree = await loadTree();
        const node = findNode(tree, relativeOf(path));
        if (!node) {
          return err(new FileError("not_found", "目标路径不存在。", resolve(path)));
        }
        const info: FileInfo = {
          kind: nodeKind(node),
          mtimeMs: 0,
          name: node.name,
          path: resolve(path),
          size: 0,
        };
        return ok(info);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async listDir(path) {
      try {
        const tree = await loadTree();
        const node = findNode(tree, relativeOf(path));
        if (!node) {
          return err(new FileError("not_found", "目标路径不存在。", resolve(path)));
        }
        if (node.kind !== "directory") {
          return err(new FileError("not_directory", "只能列出目录内容。", resolve(path)));
        }
        const children = (node.children ?? []).map<FileInfo>((child) => ({
          kind: nodeKind(child),
          mtimeMs: 0,
          name: child.name,
          path: `${resolve(path) === displayPath ? displayPath : resolve(path)}/${child.name}`,
          size: 0,
        }));
        return ok(children);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async canonicalPath(path) {
      return ok(resolve(path));
    },

    async exists(path) {
      try {
        const tree = await loadTree();
        return ok(findNode(tree, relativeOf(path)) !== null);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async createDir(path) {
      try {
        const relative = relativeOf(path);
        const segments = relative.split("/").filter(Boolean);
        const name = segments.pop();
        if (!name) {
          return err(new FileError("invalid", "无法在书籍根目录上创建目录。", resolve(path)));
        }
        const parentPath = segments.length ? `${displayPath}/${segments.join("/")}` : displayPath;
        await createWorkspaceDirectory(bookId, parentPath, name);
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async remove(path) {
      try {
        await deleteWorkspaceEntry(bookId, resolve(path));
        return ok(undefined);
      } catch (error) {
        return err(toFileError(error, resolve(path)));
      }
    },

    async createTempDir() {
      return err(new FileError("not_supported", "工作区不支持临时目录。"));
    },

    async createTempFile() {
      return err(new FileError("not_supported", "工作区不支持临时文件。"));
    },

    async cleanup() {
      // 无资源需释放。
    },

    // —— Shell：工作区无真实 shell —— //
    async exec(_command: string, _options?: ExecutionEnvExecOptions) {
      return err(
        new ExecutionError(
          "shell_unavailable",
          "书籍工作区是受限沙盒，不支持执行 shell 命令；请改用工作区检索与文件工具。",
        ),
      );
    },
  };

  return env;
}
