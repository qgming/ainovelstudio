import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROJECT_MEMORY_DIR,
  DEFAULT_PROJECT_README_PATH,
  loadProjectContext,
  parseMemoryFrontmatter,
} from "./projectContext";

const MEMORY_PROJECT = `---
name: 项目状态
description: |
  作品定位、当前阶段、近期目标。
  Use when: 确认创作方向、当前进度时读。
type: project
updated: 第012章 / 2026-06-01
---

# 项目状态
当前阶段：连载中。
`;

const MEMORY_FORESHADOW = `---
name: 伏笔台账
description: |
  已埋 / 待回收 / 已回收 的伏笔登记。
  Use when: 推进剧情或新埋伏笔时读。
type: foreshadow
updated: 第012章
---

# 伏笔台账
`;

function memoryTree() {
  return {
    children: [
      {
        kind: "directory",
        name: ".project",
        path: ".project",
        children: [
          {
            kind: "file",
            name: "README.md",
            path: DEFAULT_PROJECT_README_PATH,
          },
          {
            kind: "directory",
            name: "memory",
            path: DEFAULT_PROJECT_MEMORY_DIR,
            children: [
              {
                kind: "file",
                name: "project.md",
                path: `${DEFAULT_PROJECT_MEMORY_DIR}/project.md`,
              },
              {
                kind: "file",
                name: "伏笔台账.md",
                path: `${DEFAULT_PROJECT_MEMORY_DIR}/伏笔台账.md`,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("parseMemoryFrontmatter", () => {
  it("解析 name/type/updated，并从 description 块抽出 Use when", () => {
    const parsed = parseMemoryFrontmatter(MEMORY_PROJECT);
    expect(parsed).toMatchObject({
      name: "项目状态",
      type: "project",
      updated: "第012章 / 2026-06-01",
      useWhen: "确认创作方向、当前进度时读。",
    });
    expect(parsed?.description).toContain("作品定位");
    expect(parsed?.description).not.toContain("Use when");
  });

  it("无 frontmatter 时返回 null", () => {
    expect(parseMemoryFrontmatter("# 普通文件\n正文")).toBeNull();
  });
});

describe("project context", () => {
  it("全文注入 README，并把 memory/ 下文件按 frontmatter 生成记忆清单（path-only）", async () => {
    const readFile = vi.fn().mockImplementation(async (_bookId: string, path: string) => {
      if (path === DEFAULT_PROJECT_README_PATH) return "# 项目入口\n\n主角目标：活下去。";
      if (path === `${DEFAULT_PROJECT_MEMORY_DIR}/project.md`) return MEMORY_PROJECT;
      if (path === `${DEFAULT_PROJECT_MEMORY_DIR}/伏笔台账.md`) return MEMORY_FORESHADOW;
      throw new Error("missing");
    });
    const readTree = vi.fn().mockResolvedValue(memoryTree());

    const context = await loadProjectContext({
      readFile,
      readTree,
      workspaceBookId: "book-uuid",
    });

    expect(readFile).toHaveBeenCalledWith("book-uuid", DEFAULT_PROJECT_README_PATH);
    expect(context).toEqual({
      source: "项目默认上下文",
      files: [
        {
          content: "# 项目入口\n\n主角目标：活下去。",
          name: "README.md",
          path: ".project/README.md",
        },
        {
          name: "项目状态",
          path: ".project/memory/project.md",
          description: "作品定位、当前阶段、近期目标。",
          memoryType: "project",
          useWhen: "确认创作方向、当前进度时读。",
          updated: "第012章 / 2026-06-01",
        },
        {
          name: "伏笔台账",
          path: ".project/memory/伏笔台账.md",
          description: "已埋 / 待回收 / 已回收 的伏笔登记。",
          memoryType: "foreshadow",
          useWhen: "推进剧情或新埋伏笔时读。",
          updated: "第012章",
        },
      ],
    });
  });

  it("无 frontmatter 的记忆文件回退用首行标题作摘要", async () => {
    const readFile = vi.fn().mockImplementation(async (_bookId: string, path: string) => {
      if (path === DEFAULT_PROJECT_README_PATH) throw new Error("missing");
      if (path === `${DEFAULT_PROJECT_MEMORY_DIR}/笔记.md`) return "# 临时笔记\n内容";
      throw new Error("missing");
    });
    const readTree = vi.fn().mockResolvedValue({
      children: [
        {
          kind: "directory",
          name: ".project",
          path: ".project",
          children: [
            {
              kind: "directory",
              name: "memory",
              path: DEFAULT_PROJECT_MEMORY_DIR,
              children: [
                {
                  kind: "file",
                  name: "笔记.md",
                  path: `${DEFAULT_PROJECT_MEMORY_DIR}/笔记.md`,
                },
              ],
            },
          ],
        },
      ],
    });

    const context = await loadProjectContext({
      readFile,
      readTree,
      workspaceBookId: "book-uuid",
    });

    expect(context?.files).toEqual([
      {
        name: "笔记.md",
        path: ".project/memory/笔记.md",
        description: "临时笔记",
        memoryType: undefined,
        useWhen: undefined,
        updated: undefined,
      },
    ]);
  });

  it("README 与 memory 都缺失时返回 null", async () => {
    const context = await loadProjectContext({
      readFile: vi.fn().mockRejectedValue(new Error("missing")),
      readTree: vi.fn().mockResolvedValue({ children: [] }),
      workspaceBookId: "book-uuid",
    });
    expect(context).toBeNull();
  });

  it("active file 提供 readRelations 时，把关联文件追加为 path-only 条目", async () => {
    const readFile = vi.fn().mockImplementation(async (_bookId: string, path: string) => {
      if (path === DEFAULT_PROJECT_README_PATH) return "# 项目入口";
      throw new Error("missing");
    });
    const readRelations = vi.fn().mockResolvedValue([
      { otherEntryPath: "设定/林夕.md", relationship: "出场人物", note: "本章主角" },
      { otherEntryPath: "设定/苏家.md", relationship: "涉及势力", note: null },
      { otherEntryPath: "设定/无标签.md", relationship: "", note: null },
    ]);

    const context = await loadProjectContext({
      activeFilePath: "正文/第三章.md",
      readFile,
      readRelations,
      workspaceBookId: "book-uuid",
    });

    expect(readRelations).toHaveBeenCalledWith("book-uuid", "正文/第三章.md");
    const relationFiles = context?.files.filter((file) =>
      file.description?.startsWith("[关联文件 · "),
    ) ?? [];
    expect(relationFiles).toEqual([
      {
        description: "[关联文件 · 出场人物] 本章主角",
        name: "林夕.md",
        path: "设定/林夕.md",
      },
      {
        description: "[关联文件 · 涉及势力]",
        name: "苏家.md",
        path: "设定/苏家.md",
      },
      {
        description: "[关联文件 · 未标注关系]",
        name: "无标签.md",
        path: "设定/无标签.md",
      },
    ]);
  });

  it("没有 activeFilePath 时不调用 readRelations", async () => {
    const readFile = vi.fn().mockResolvedValue("# 项目入口");
    const readRelations = vi.fn().mockResolvedValue([]);

    await loadProjectContext({
      readFile,
      readRelations,
      workspaceBookId: "book-uuid",
    });

    expect(readRelations).not.toHaveBeenCalled();
  });

  it("readRelations 抛错时不阻塞主流程，仍保留 README", async () => {
    const readFile = vi.fn().mockImplementation(async (_bookId: string, path: string) => {
      if (path === DEFAULT_PROJECT_README_PATH) return "# 项目入口";
      throw new Error("missing");
    });
    const readRelations = vi.fn().mockRejectedValue(new Error("relations broken"));

    const context = await loadProjectContext({
      activeFilePath: "正文/第三章.md",
      readFile,
      readRelations,
      workspaceBookId: "book-uuid",
    });

    expect(context?.files.some((file) => file.path === DEFAULT_PROJECT_README_PATH)).toBe(true);
    expect(
      context?.files.some((file) => file.description?.startsWith("[关联文件")),
    ).toBe(false);
  });
});
