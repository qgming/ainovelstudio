import {
  createExpansionEntry,
  deleteExpansionEntry,
  getExpansionWorkspaceDetail,
  readExpansionEntry,
  renameExpansionEntry,
  writeExpansionEntry,
} from "./api";
import type { ExpansionSection } from "./types";
import type { AgentTool } from "../agent/runtime";
import { ok, ensureString } from "../agent/tools/shared";

type ExpansionAgentToolsetInput = {
  onWorkspaceMutated?: () => Promise<void>;
  workspaceId: string;
};

type ExpansionEntryRef = {
  name: string;
  path: string;
  section: ExpansionSection;
};

function normalizeVirtualPath(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function splitVirtualPath(value: string): { entryPath: string; section: ExpansionSection | null } {
  const normalized = normalizeVirtualPath(value);
  if (!normalized) {
    return { entryPath: "", section: null };
  }

  const [head, ...rest] = normalized.split("/");
  if (head === "project" || head === "settings" || head === "chapters") {
    return { entryPath: rest.join("/"), section: head };
  }

  return { entryPath: normalized, section: null };
}

async function listAllEntries(workspaceId: string) {
  const detail = await getExpansionWorkspaceDetail(workspaceId);
  const entries: ExpansionEntryRef[] = [
    ...detail.projectEntries.map((entry) => ({ ...entry, section: "project" as const })),
    ...detail.settingEntries.map((entry) => ({ ...entry, section: "settings" as const })),
    ...detail.chapterEntries.map((entry) => ({ ...entry, section: "chapters" as const })),
  ];
  return { detail, entries };
}

async function findEntry(path: string) {
  const { section, entryPath } = splitVirtualPath(path);
  if (!section || !entryPath) {
    throw new Error("路径必须是 project/...、settings/... 或 chapters/...。");
  }
  return { entryPath, section };
}

function buildTree(detail: Awaited<ReturnType<typeof getExpansionWorkspaceDetail>>) {
  return {
    kind: "directory",
    name: "expansion",
    path: ".",
    children: [
      {
        kind: "directory",
        name: "project",
        path: "project",
        children: detail.projectEntries.map((entry) => ({
          kind: "file",
          name: entry.path,
          path: `project/${entry.path}`,
        })),
      },
      {
        kind: "directory",
        name: "settings",
        path: "settings",
        children: detail.settingEntries.map((entry) => ({
          kind: "file",
          name: entry.path,
          path: `settings/${entry.path}`,
        })),
      },
      {
        kind: "directory",
        name: "chapters",
        path: "chapters",
        children: detail.chapterEntries.map((entry) => ({
          kind: "file",
          name: entry.path,
          path: `chapters/${entry.path}`,
        })),
      },
    ],
  };
}

function pickRange(lines: string[], startLine?: number, endLine?: number) {
  const start = Math.max((startLine ?? 1) - 1, 0);
  const end = Math.min(endLine ?? lines.length, lines.length);
  return lines.slice(start, end).join("\n");
}

function readByHeading(content: string, heading: string) {
  const lines = content.split(/\r?\n/);
  const normalizedHeading = heading.replace(/^#+\s*/, "").trim();
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (start < 0 && line.replace(/^#+\s*/, "") === normalizedHeading) {
      start = index;
      continue;
    }
    if (start >= 0 && /^#+\s+/.test(line)) {
      end = index;
      break;
    }
  }
  if (start < 0) {
    return content;
  }
  return lines.slice(start, end).join("\n");
}

export function createExpansionAgentToolset({
  onWorkspaceMutated,
  workspaceId,
}: ExpansionAgentToolsetInput): Record<string, AgentTool> {
  return {
    browse: {
      description: "浏览扩写工作区结构",
      execute: async (input) => {
        const mode = String(input.mode ?? "list");
        const targetPath = normalizeVirtualPath(String(input.path ?? ""));
        const { detail } = await listAllEntries(workspaceId);
        const tree = buildTree(detail);

        if (mode === "tree") {
          return ok("已读取扩写工作区目录树。", tree);
        }

        if (!targetPath) {
          return ok("已列出扩写工作区根目录。", {
            children: tree.children,
            kind: "directory",
            path: ".",
          });
        }

        const { section, entryPath } = splitVirtualPath(targetPath);
        if (!section) {
          const matched = tree.children.find((child) => child.path === targetPath);
          if (!matched) {
            throw new Error("未找到目标路径。");
          }
          return ok(`已列出 ${targetPath} 下的条目。`, {
            children: matched.children ?? [],
            kind: "directory",
            path: matched.path,
          });
        }

        if (!entryPath) {
          const matched = tree.children.find((child) => child.path === section);
          return ok(`已列出 ${section} 下的条目。`, {
            children: matched?.children ?? [],
            kind: "directory",
            path: section,
          });
        }

        return ok(`已读取 ${targetPath} 的路径信息。`, {
          kind: "file",
          path: targetPath,
          section,
        });
      },
    },
    search: {
      description: "搜索扩写工作区内容",
      execute: async (input) => {
        const query = ensureString(input.query, "search.query").toLowerCase();
        const scope = String(input.scope ?? "all");
        const limit = Number.isFinite(Number(input.limit)) ? Math.max(Number(input.limit), 1) : 50;
        const { entries } = await listAllEntries(workspaceId);
        const matches: Array<{ matchType: string; path: string; preview: string }> = [];

        for (const entry of entries) {
          const fullPath = `${entry.section}/${entry.path}`;
          if (scope !== "content" && fullPath.toLowerCase().includes(query)) {
            matches.push({ matchType: "name", path: fullPath, preview: fullPath });
          }
          if (matches.length >= limit) {
            break;
          }
          if (scope !== "names") {
            const content = await readExpansionEntry(workspaceId, entry.section, entry.path);
            const hitIndex = content.toLowerCase().indexOf(query);
            if (hitIndex >= 0) {
              matches.push({
                matchType: "content",
                path: fullPath,
                preview: content.slice(Math.max(hitIndex - 30, 0), hitIndex + 80).replace(/\s+/g, " "),
              });
            }
          }
          if (matches.length >= limit) {
            break;
          }
        }

        return ok(`已找到 ${matches.length} 条匹配。`, { matches });
      },
    },
    read: {
      description: "读取扩写工作区文件",
      execute: async (input) => {
        const mode = String(input.mode ?? "full");
        const { entryPath, section } = await findEntry(String(input.path ?? ""));
        const content = await readExpansionEntry(workspaceId, section, entryPath);
        const lines = content.split(/\r?\n/);

        if (mode === "head") {
          const limit = Number(input.limit ?? 80);
          return ok(`已读取 ${section}/${entryPath} 开头片段。`, lines.slice(0, limit).join("\n"));
        }
        if (mode === "tail") {
          const limit = Number(input.limit ?? 80);
          return ok(`已读取 ${section}/${entryPath} 结尾片段。`, lines.slice(-limit).join("\n"));
        }
        if (mode === "range") {
          return ok(`已读取 ${section}/${entryPath} 指定行段。`, pickRange(lines, Number(input.startLine), Number(input.endLine)));
        }
        if (mode === "heading_range") {
          return ok(`已读取 ${section}/${entryPath} 的标题块。`, readByHeading(content, String(input.heading ?? "")));
        }

        return ok(`已读取 ${section}/${entryPath} 全文。`, content);
      },
    },
    write: {
      description: "整文件写入扩写工作区",
      execute: async (input) => {
        const { entryPath, section } = await findEntry(String(input.path ?? ""));
        await writeExpansionEntry(workspaceId, section, entryPath, String(input.content ?? ""));
        await onWorkspaceMutated?.();
        return ok(`已写入 ${section}/${entryPath}`);
      },
    },
    path: {
      description: "处理扩写工作区结构变更",
      execute: async (input) => {
        const action = ensureString(input.action, "path.action");
        if (action === "create_file") {
          const parentPath = normalizeVirtualPath(String(input.parentPath ?? ""));
          if (parentPath !== "settings" && parentPath !== "chapters") {
            throw new Error("扩写模式只支持在 settings 或 chapters 下创建文件。");
          }
          const created = await createExpansionEntry(workspaceId, parentPath, ensureString(input.name, "path.name"));
          await onWorkspaceMutated?.();
          return ok(`已创建 ${created.section}/${created.path}`);
        }

        if (action === "rename") {
          const { entryPath, section } = await findEntry(String(input.path ?? ""));
          if (section === "project") {
            throw new Error("project 分区文件不能重命名。");
          }
          const renamed = await renameExpansionEntry(workspaceId, section, entryPath, ensureString(input.name, "path.name"));
          await onWorkspaceMutated?.();
          return ok(`已重命名为 ${renamed.section}/${renamed.path}`);
        }

        if (action === "delete") {
          const { entryPath, section } = await findEntry(String(input.path ?? ""));
          if (section === "project") {
            throw new Error("project 分区文件不能删除。");
          }
          await deleteExpansionEntry(workspaceId, section, entryPath);
          await onWorkspaceMutated?.();
          return ok(`已删除 ${section}/${entryPath}`);
        }

        throw new Error("扩写模式暂不支持这个路径动作。");
      },
    },
  };
}
