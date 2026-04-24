import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateAgent,
  mockCreateSkill,
  mockCreateSkillReferenceFile,
  mockCreateWorkspaceDirectory,
  mockCreateWorkspaceTextFile,
  mockDeleteInstalledAgent,
  mockDeleteInstalledSkill,
  mockDeleteWorkspaceEntry,
  mockMoveWorkspaceEntry,
  mockReadAgentFileContent,
  mockReadSkillFileContent,
  mockReadWorkspaceTextFile,
  mockReadWorkspaceTree,
  mockRenameWorkspaceEntry,
  mockScanInstalledAgents,
  mockScanInstalledSkills,
  mockSearchWorkspaceContent,
  mockForwardProviderRequestViaTauri,
  mockWriteAgentFileContent,
  mockWriteSkillFileContent,
  mockWriteWorkspaceTextFile,
} = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
  mockCreateSkill: vi.fn(),
  mockCreateSkillReferenceFile: vi.fn(),
  mockCreateWorkspaceDirectory: vi.fn(),
  mockCreateWorkspaceTextFile: vi.fn(),
  mockDeleteInstalledAgent: vi.fn(),
  mockDeleteInstalledSkill: vi.fn(),
  mockDeleteWorkspaceEntry: vi.fn(),
  mockMoveWorkspaceEntry: vi.fn(),
  mockReadAgentFileContent: vi.fn(),
  mockReadSkillFileContent: vi.fn(),
  mockReadWorkspaceTextFile: vi.fn(),
  mockReadWorkspaceTree: vi.fn(),
  mockRenameWorkspaceEntry: vi.fn(),
  mockScanInstalledAgents: vi.fn(),
  mockScanInstalledSkills: vi.fn(),
  mockSearchWorkspaceContent: vi.fn(),
  mockForwardProviderRequestViaTauri: vi.fn(),
  mockWriteAgentFileContent: vi.fn(),
  mockWriteSkillFileContent: vi.fn(),
  mockWriteWorkspaceTextFile: vi.fn(),
}));

vi.mock("../bookWorkspace/api", () => ({
  createWorkspaceDirectory: mockCreateWorkspaceDirectory,
  createWorkspaceTextFile: mockCreateWorkspaceTextFile,
  deleteWorkspaceEntry: mockDeleteWorkspaceEntry,
  moveWorkspaceEntry: mockMoveWorkspaceEntry,
  readWorkspaceTextFile: mockReadWorkspaceTextFile,
  readWorkspaceTree: mockReadWorkspaceTree,
  renameWorkspaceEntry: mockRenameWorkspaceEntry,
  searchWorkspaceContent: mockSearchWorkspaceContent,
  writeWorkspaceTextFile: mockWriteWorkspaceTextFile,
}));

vi.mock("../agents/api", () => ({
  createAgent: mockCreateAgent,
  deleteInstalledAgent: mockDeleteInstalledAgent,
  readAgentFileContent: mockReadAgentFileContent,
  scanInstalledAgents: mockScanInstalledAgents,
  writeAgentFileContent: mockWriteAgentFileContent,
}));

vi.mock("../skills/api", () => ({
  createSkill: mockCreateSkill,
  createSkillReferenceFile: mockCreateSkillReferenceFile,
  deleteInstalledSkill: mockDeleteInstalledSkill,
  readSkillFileContent: mockReadSkillFileContent,
  scanInstalledSkills: mockScanInstalledSkills,
  writeSkillFileContent: mockWriteSkillFileContent,
}));

vi.mock("./providerApi", () => ({
  forwardProviderRequestViaTauri: mockForwardProviderRequestViaTauri,
}));

import { createGlobalToolset, createLocalResourceToolset, createWorkspaceToolset } from "./tools";
import { searxngSearchService } from "./tools/searxngSearchService";

describe("createWorkspaceToolset", () => {
  beforeEach(() => {
    mockCreateAgent.mockReset();
    mockCreateSkill.mockReset();
    mockCreateSkillReferenceFile.mockReset();
    mockCreateWorkspaceDirectory.mockReset();
    mockCreateWorkspaceTextFile.mockReset();
    mockDeleteInstalledAgent.mockReset();
    mockDeleteInstalledSkill.mockReset();
    mockDeleteWorkspaceEntry.mockReset();
    mockMoveWorkspaceEntry.mockReset();
    mockReadAgentFileContent.mockReset();
    mockReadSkillFileContent.mockReset();
    mockReadWorkspaceTextFile.mockReset();
    mockReadWorkspaceTree.mockReset();
    mockRenameWorkspaceEntry.mockReset();
    mockScanInstalledAgents.mockReset();
    mockScanInstalledSkills.mockReset();
    mockSearchWorkspaceContent.mockReset();
    mockForwardProviderRequestViaTauri.mockReset();
    mockWriteAgentFileContent.mockReset();
    mockWriteSkillFileContent.mockReset();
    mockWriteWorkspaceTextFile.mockReset();
    searxngSearchService.setInstances([
      "https://search-a.example",
      "https://search-b.example",
    ]);
  });

  it("write 写入文件后会触发工作区刷新回调", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });

    const result = await toolset.write.execute({
      content: "新内容",
      path: "章节/第一章.md",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "章节/第一章.md",
      "新内容",
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, summary: "已写入 章节/第一章.md" });
  });

  it("browse 可以列出目录内容", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTree.mockResolvedValue({
      children: [
        { kind: "directory", name: "章节", path: "C:/books/北境余烬/章节" },
        {
          kind: "file",
          name: "README.md",
          path: "C:/books/北境余烬/README.md",
        },
      ],
      kind: "directory",
      name: "北境余烬",
      path: "C:/books/北境余烬",
    });

    const result = await toolset.browse.execute({ mode: "list" });

    expect(result).toEqual({
      ok: true,
      summary: [
        "." + " 下共有 2 项：",
        "- [目录] 章节",
        "- [文件] README.md",
      ].join("\n"),
      data: {
        children: [
          {
            childCount: 0,
            extension: undefined,
            kind: "directory",
            name: "章节",
            path: "章节",
          },
          {
            childCount: 0,
            extension: undefined,
            kind: "file",
            name: "README.md",
            path: "README.md",
          },
        ],
        kind: "directory",
        name: "北境余烬",
        path: ".",
      },
    });
  });

  it("browse 支持按类型、扩展名和数量筛选子项", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTree.mockResolvedValue({
      children: [
        {
          extension: "md",
          kind: "file",
          name: "章节A.md",
          path: "C:/books/北境余烬/章节A.md",
        },
        {
          extension: "txt",
          kind: "file",
          name: "灵感.txt",
          path: "C:/books/北境余烬/灵感.txt",
        },
        { kind: "directory", name: "资料", path: "C:/books/北境余烬/资料" },
      ],
      kind: "directory",
      name: "北境余烬",
      path: "C:/books/北境余烬",
    });

    const result = await toolset.browse.execute({
      extensions: ["md"],
      kind: "file",
      limit: 1,
      mode: "list",
      sortBy: "type",
    });

    expect(result).toEqual({
      ok: true,
      summary: [
        "." + " 下共有 1 项：",
        "- [文件] 章节A.md",
      ].join("\n"),
      data: {
        children: [
          {
            childCount: 0,
            extension: "md",
            kind: "file",
            name: "章节A.md",
            path: "章节A.md",
          },
        ],
        kind: "directory",
        name: "北境余烬",
        path: ".",
      },
    });
  });

  it("search 会返回过滤后的结构化命中结果", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockSearchWorkspaceContent.mockResolvedValue([
      {
        matchType: "directory_name",
        path: "设定/人物档案",
      },
      {
        matchType: "content",
        path: "章节/第一卷/第1章.md",
        lineNumber: 12,
        lineText: "主角在雪夜第一次听见钟声。",
      },
    ]);

    const result = await toolset.search.execute({
      limit: 5,
      path: "章节",
      query: "钟声",
      scope: "content",
    });

    expect(result).toEqual({
      ok: true,
      summary: [
        "共找到 1 条与“钟声”相关的结果：",
        "- [内容] 章节/第一卷/第1章.md:12 主角在雪夜第一次听见钟声。",
      ].join("\n"),
      data: [
        {
          lineNumber: 12,
          lineText: "主角在雪夜第一次听见钟声。",
          matchEnd: 12,
          matchStart: 10,
          matchType: "content",
          path: "章节/第一卷/第1章.md",
          score: expect.any(Number),
        },
      ],
    });
  });

  it("read 支持读取指定行段", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      "第一行\n第二行\n第三行\n第四行",
    );

    const result = await toolset.read.execute({
      endLine: 3,
      mode: "range",
      path: "章节/第一卷/第1章.md",
      startLine: 2,
    });

    expect(result).toEqual({
      ok: true,
      summary: [
        "[章节/第一卷/第1章.md | lines 2-3]",
        "2 | 第二行",
        "3 | 第三行",
      ].join("\n"),
    });
  });

  it("search 支持大小写、整词、上下文和每文件限额", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockSearchWorkspaceContent.mockResolvedValue([
      {
        matchType: "content",
        path: "章节/第一卷/第1章.md",
        lineNumber: 2,
        lineText: "hero HERO hero",
      },
      {
        matchType: "content",
        path: "章节/第一卷/第1章.md",
        lineNumber: 4,
        lineText: "hero again",
      },
      {
        matchType: "content",
        path: "章节/第一卷/第2章.md",
        lineNumber: 3,
        lineText: "heroic ending",
      },
    ]);
    mockReadWorkspaceTextFile.mockResolvedValue(
      "第一行\nhero HERO hero\n第三行\nhero again\n尾声",
    );

    const result = await toolset.search.execute({
      afterLines: 1,
      beforeLines: 1,
      caseSensitive: true,
      maxPerFile: 1,
      query: "hero",
      scope: "content",
      wholeWord: true,
    });

    expect(mockReadWorkspaceTextFile).toHaveBeenCalledTimes(1);
    expect(mockReadWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary: [
        "共找到 1 条与“hero”相关的结果：",
        "- [内容] 章节/第一卷/第1章.md:2 hero HERO hero (上下文 1-3)",
      ].join("\n"),
      data: [
        {
          contextEndLine: 3,
          contextStartLine: 1,
          contextText: [
            "[章节/第一卷/第1章.md | lines 1-3]",
            "1 | 第一行",
            "2 | hero HERO hero",
            "3 | 第三行",
          ].join("\n"),
          lineNumber: 2,
          lineText: "hero HERO hero",
          matchEnd: 4,
          matchStart: 0,
          matchType: "content",
          path: "章节/第一卷/第1章.md",
          score: expect.any(Number),
        },
      ],
    });
  });

  it("search 支持 all_terms 模式的多词匹配", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockSearchWorkspaceContent
      .mockResolvedValueOnce([
        {
          matchType: "content",
          path: "章节/第一卷/第1章.md",
          lineNumber: 8,
          lineText: "hero 与 bell 同时出现",
        },
        {
          matchType: "content",
          path: "章节/第一卷/第1章.md",
          lineNumber: 10,
          lineText: "只有 hero",
        },
      ])
      .mockResolvedValueOnce([
        {
          matchType: "content",
          path: "章节/第一卷/第1章.md",
          lineNumber: 8,
          lineText: "hero 与 bell 同时出现",
        },
        {
          matchType: "content",
          path: "章节/第一卷/第2章.md",
          lineNumber: 2,
          lineText: "只有 bell",
        },
      ]);

    const result = await toolset.search.execute({
      matchMode: "all_terms",
      query: "hero bell",
      scope: "content",
    });

    expect(mockSearchWorkspaceContent).toHaveBeenNthCalledWith(
      1,
      rootPath,
      "hero",
      expect.any(Number),
      undefined,
    );
    expect(mockSearchWorkspaceContent).toHaveBeenNthCalledWith(
      2,
      rootPath,
      "bell",
      expect.any(Number),
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary: [
        "共找到 1 条与“hero bell”相关的结果：",
        "- [内容] 章节/第一卷/第1章.md:8 hero 与 bell 同时出现",
      ].join("\n"),
      data: [
        {
          lineNumber: 8,
          lineText: "hero 与 bell 同时出现",
          matchEnd: 4,
          matchStart: 0,
          matchType: "content",
          path: "章节/第一卷/第1章.md",
          score: expect.any(Number),
        },
      ],
    });
  });

  it("read 支持按锚点读取附近行段", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      "第一行\n铺垫句\n主角抬头看向夜空\n情绪落点\n尾声",
    );

    const result = await toolset.read.execute({
      afterLines: 1,
      anchor: "主角抬头",
      beforeLines: 1,
      mode: "anchor_range",
      path: "章节/第一卷/第1章.md",
    });

    expect(result).toEqual({
      ok: true,
      summary: [
        "[章节/第一卷/第1章.md | lines 2-4]",
        "2 | 铺垫句",
        "3 | 主角抬头看向夜空",
        "4 | 情绪落点",
      ].join("\n"),
    });
  });

  it("read 支持按 Markdown 标题读取整段内容", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      [
        "# 卷一",
        "卷首说明",
        "## 第二幕",
        "第二幕正文",
        "### 小节",
        "小节正文",
        "## 第三幕",
        "第三幕正文",
      ].join("\n"),
    );

    const result = await toolset.read.execute({
      heading: "第二幕",
      mode: "heading_range",
      path: "05-完整大纲.md",
    });

    expect(result).toEqual({
      ok: true,
      summary: [
        "[05-完整大纲.md | lines 3-6]",
        "3 | ## 第二幕",
        "4 | 第二幕正文",
        "5 | ### 小节",
        "6 | 小节正文",
      ].join("\n"),
    });
  });

  it("word_count 会返回稳定的字数统计结果", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      "第一段有3人。\nHello world!\n\n第二段",
    );

    const result = await toolset.word_count.execute({
      path: "章节/第一卷/第1章.md",
    });

    expect(mockReadWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary: [
        "已统计 章节/第一卷/第1章.md：",
        "- 字符数：25",
        "- 非空白字符数：21",
        "- 中文字符数：8",
        "- 英文单词数：2",
        "- 数字数：1",
        "- 行数：4",
        "- 段落数：2",
      ].join("\n"),
      data: {
        path: "章节/第一卷/第1章.md",
        characterCount: 25,
        nonWhitespaceCharacterCount: 21,
        chineseCharacterCount: 8,
        latinWordCount: 2,
        digitCount: 1,
        lineCount: 4,
        paragraphCount: 2,
      },
    });
  });

  it("edit 支持精确替换文本并刷新工作区", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue("旧段落\n目标句子\n尾声");

    const result = await toolset.edit.execute({
      action: "replace",
      content: "新句子",
      path: "章节/第一卷/第1章.md",
      target: "目标句子",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      "旧段落\n新句子\n尾声",
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新 章节/第一卷/第1章.md（replace，命中 1 处）。",
    });
  });

  it("edit 支持按行段整体替换文本", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      "第一行\n第二行\n第三行\n第四行\n",
    );

    const result = await toolset.edit.execute({
      action: "replace_lines",
      content: "替换后的第二行\n替换后的第三行",
      endLine: 3,
      path: "章节/第一卷/第1章.md",
      startLine: 2,
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      "第一行\n替换后的第二行\n替换后的第三行\n第四行\n",
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新 章节/第一卷/第1章.md（replace_lines，行 2-3）。",
    });
  });

  it("edit 支持按锚点范围整体替换文本", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      "第一行\n铺垫句\n主角抬头看向夜空\n情绪落点\n尾声",
    );

    const result = await toolset.edit.execute({
      action: "replace_anchor_range",
      afterLines: 1,
      anchor: "主角抬头",
      beforeLines: 1,
      content: "新的场景段落\n新的情绪落点",
      path: "章节/第一卷/第1章.md",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      "第一行\n新的场景段落\n新的情绪落点\n尾声",
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新 章节/第一卷/第1章.md（replace_anchor_range，行 2-4）。",
    });
  });

  it("edit 支持按 Markdown 标题块整体替换文本", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      [
        "# 卷一",
        "卷首说明",
        "## 第二幕",
        "第二幕正文",
        "### 小节",
        "小节正文",
        "## 第三幕",
        "第三幕正文",
      ].join("\n"),
    );

    const result = await toolset.edit.execute({
      action: "replace_heading_range",
      content: "## 第二幕\n重写后的第二幕正文",
      heading: "第二幕",
      path: "05-完整大纲.md",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "05-完整大纲.md",
      [
        "# 卷一",
        "卷首说明",
        "## 第二幕",
        "重写后的第二幕正文",
        "## 第三幕",
        "第三幕正文",
      ].join("\n"),
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新 05-完整大纲.md（replace_heading_range，行 3-6）。",
    });
  });

  it("json 支持按指针局部更新数据", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      '{\n  "stage": "构思期",\n  "currentChapter": "第001章"\n}\n',
    );

    const result = await toolset.json.execute({
      action: "set",
      path: "正文/创作状态追踪器.json",
      pointer: "/currentChapter",
      value: "第002章",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "正文/创作状态追踪器.json",
      '{\n  "stage": "构思期",\n  "currentChapter": "第002章"\n}\n',
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary:
        "已更新 正文/创作状态追踪器.json 中 /currentChapter 的 JSON 数据。",
      data: {
        action: "set",
        path: "正文/创作状态追踪器.json",
        pointer: "/currentChapter",
        value: "第002章",
      },
    });
  });

  it("json 支持批量执行多个局部操作并只写回一次", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      [
        "{",
        '  "stage": "构思期",',
        '  "tags": ["悬疑"],',
        '  "meta": {',
        '    "draft": true,',
        '    "owner": "A"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const result = await toolset.json.execute({
      action: "batch",
      operations: [
        { action: "set", pointer: "/stage", value: "写作期" },
        { action: "append", pointer: "/tags", value: "反转" },
        { action: "merge", pointer: "/meta", value: { updated: true } },
        { action: "delete", pointer: "/meta/draft" },
      ],
      path: "正文/创作状态追踪器.json",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledTimes(1);
    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "正文/创作状态追踪器.json",
      [
        "{",
        '  "stage": "写作期",',
        '  "tags": [',
        '    "悬疑",',
        '    "反转"',
        "  ],",
        '  "meta": {',
        '    "owner": "A",',
        '    "updated": true',
        "  }",
        "}",
        "",
      ].join("\n"),
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary:
        "已批量更新 正文/创作状态追踪器.json 中 4 个 JSON 操作。",
      data: {
        action: "batch",
        operations: [
          { action: "set", pointer: "/stage", value: "写作期" },
          { action: "append", pointer: "/tags", value: ["悬疑", "反转"] },
          {
            action: "merge",
            pointer: "/meta",
            value: { draft: true, owner: "A", updated: true },
          },
          { action: "delete", deleted: true, pointer: "/meta/draft" },
        ],
        operationsApplied: 4,
        path: "正文/创作状态追踪器.json",
      },
    });
  });

  it("json 支持按模板补齐缺失字段", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      '{\n  "progress": {\n    "currentWordCount": 1200\n  }\n}\n',
    );

    const result = await toolset.json.execute({
      action: "ensure_template",
      path: ".project/status/project-state.json",
      pointer: "/progress",
      value: {
        currentWordCount: 0,
        targetWordCount: null,
        completedChapters: 0,
      },
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      ".project/status/project-state.json",
      [
        "{",
        '  "progress": {',
        '    "currentWordCount": 1200,',
        '    "targetWordCount": null,',
        '    "completedChapters": 0',
        "  }",
        "}",
        "",
      ].join("\n"),
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary:
        "已按模板补齐 .project/status/project-state.json 中 /progress 的 JSON 数据。",
      data: {
        action: "ensure_template",
        path: ".project/status/project-state.json",
        pointer: "/progress",
        value: {
          currentWordCount: 1200,
          targetWordCount: null,
          completedChapters: 0,
        },
      },
    });
  });

  it("json 支持追加历史记录并自动补时间戳", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      '{\n  "recentUpdates": []\n}\n',
    );

    const result = await toolset.json.execute({
      action: "history_append",
      path: ".project/status/project-state.json",
      pointer: "/recentUpdates",
      timestamp: "2026-04-22T12:00:00+08:00",
      value: {
        note: "完成第 3 章规划",
        type: "chapter_plan",
      },
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      ".project/status/project-state.json",
      [
        "{",
        '  "recentUpdates": [',
        "    {",
        '      "note": "完成第 3 章规划",',
        '      "type": "chapter_plan",',
        '      "updatedAt": "2026-04-22T12:00:00+08:00"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary:
        "已向 .project/status/project-state.json 中 /recentUpdates 追加一条历史记录。",
      data: {
        action: "history_append",
        path: ".project/status/project-state.json",
        pointer: "/recentUpdates",
        value: {
          note: "完成第 3 章规划",
          type: "chapter_plan",
          updatedAt: "2026-04-22T12:00:00+08:00",
        },
      },
    });
  });

  it("json 支持向字符串属性追加文本而不重写整个对象", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      [
        "{",
        '  "chapter": {',
        '    "outline": "## 情节点\\n\\n- 旧细纲",',
        '    "content": "第一段正文"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const result = await toolset.json.execute({
      action: "text_append",
      path: "正文/第一章.json",
      pointer: "/chapter/content",
      separator: "\n\n",
      value: "第二段正文",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      "正文/第一章.json",
      [
        "{",
        '  "chapter": {',
        '    "outline": "## 情节点\\n\\n- 旧细纲",',
        '    "content": "第一段正文\\n\\n第二段正文"',
        "  }",
        "}",
        "",
      ].join("\n"),
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary: "已更新 正文/第一章.json 中 /chapter/content 的 JSON 数据。",
      data: {
        action: "text_append",
        path: "正文/第一章.json",
        pointer: "/chapter/content",
        value: "第一段正文\n\n第二段正文",
      },
    });
  });

  it("json 支持通过 patch 执行标准 JSON 补丁操作", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReadWorkspaceTextFile.mockResolvedValue(
      [
        "{",
        '  "progress": {',
        '    "currentChapter": 2',
        "  },",
        '  "recentUpdates": []',
        "}",
        "",
      ].join("\n"),
    );

    const result = await toolset.json.execute({
      action: "patch",
      path: ".project/status/project-state.json",
      patch: [
        { op: "replace", path: "/progress/currentChapter", value: 3 },
        { op: "add", path: "/recentUpdates/-", value: { type: "chapter_completed" } },
      ],
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(
      rootPath,
      ".project/status/project-state.json",
      [
        "{",
        '  "progress": {',
        '    "currentChapter": 3',
        "  },",
        '  "recentUpdates": [',
        "    {",
        '      "type": "chapter_completed"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      summary:
        "已按 patch 更新 .project/status/project-state.json 中 2 个 JSON 操作。",
      data: {
        action: "patch",
        operations: [
          { op: "replace", path: "/progress/currentChapter", value: 3 },
          { op: "add", path: "/recentUpdates/-", value: { type: "chapter_completed" } },
        ],
        operationsApplied: 2,
        path: ".project/status/project-state.json",
      },
    });
  });

  it("path 支持迁移文件或文件夹到指定目录", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockMoveWorkspaceEntry.mockResolvedValue(
      "C:/books/北境余烬/归档/第一卷/第001章.md",
    );

    const result = await toolset.path.execute({
      action: "move",
      path: "草稿/第001章.md",
      targetParentPath: "归档/第一卷",
    });

    expect(result).toEqual({
      ok: true,
      summary: "已迁移到 归档/第一卷/第001章.md",
    });
  });
});

describe("createGlobalToolset", () => {
  beforeEach(() => {
    mockForwardProviderRequestViaTauri.mockReset();
    searxngSearchService.setInstances([
      "https://search-a.example",
      "https://search-b.example",
    ]);
  });

  it("web_search 会返回解析后的公开网页结果", async () => {
    mockForwardProviderRequestViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {},
      body: [
        '<article class="result">',
        '<h3><a href="https://example.com/post-1">第一条 <em>结果</em></a></h3>',
        '<p class="content">这是第一条摘要。</p>',
        "</article>",
      ].join(""),
    });
    const toolset = createGlobalToolset();

    const result = await toolset.web_search.execute({
      limit: 5,
      query: "番茄小说 最新规则",
    });

    expect(mockForwardProviderRequestViaTauri).toHaveBeenCalledWith({
      headers: expect.objectContaining({
        Accept: "text/html,application/xhtml+xml",
      }),
      method: "GET",
      url: expect.stringContaining(
        "https://search-a.example/search?q=%E7%95%AA%E8%8C%84%E5%B0%8F%E8%AF%B4",
      ),
    });
    expect(result).toEqual({
      ok: true,
      summary:
        "已搜索“番茄小说 最新规则”，通过 https://search-a.example 返回 1 条结果。",
      data: {
        success: true,
        query: "番茄小说 最新规则",
        provider: "searxng",
        instance: "https://search-a.example",
        totalCount: 1,
        results: [
          {
            url: "https://example.com/post-1",
            title: "第一条 结果",
            snippet: "这是第一条摘要。",
            source: "https://example.com/post-1",
          },
        ],
      },
    });
  });

  it("web_fetch 会返回网页标题和主要正文", async () => {
    mockForwardProviderRequestViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {},
      body: [
        "<html><head><title>年度盘点</title></head><body>",
        "<main>",
        "<p>2024 年短篇小说市场持续升温，悬疑、情感反转和女性成长题材表现突出。</p>",
        "<p>平台侧更偏好强钩子、快反转、单章高潮密度更高的故事结构。</p>",
        "</main>",
        "</body></html>",
      ].join(""),
    });
    const toolset = createGlobalToolset();

    const result = await toolset.web_fetch.execute({
      url: "https://example.com/article-1",
    });

    expect(mockForwardProviderRequestViaTauri).toHaveBeenCalledWith({
      headers: expect.objectContaining({
        Accept: "text/html,application/xhtml+xml",
      }),
      method: "GET",
      url: "https://example.com/article-1",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        success: true,
        url: "https://example.com/article-1",
        title: "年度盘点",
        provider: "direct_html",
        truncated: false,
      },
    });
    expect((result.data as { content: string }).content).toContain(
      "2024 年短篇小说市场持续升温",
    );
    expect((result.data as { content: string }).content).toContain(
      "平台侧更偏好强钩子",
    );
  });

  it("web_fetch 支持按标题块提取网页内容", async () => {
    mockForwardProviderRequestViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {},
      body: [
        "<html><head><title>教程</title></head><body>",
        "<main>",
        "<h2>概览</h2>",
        "<p>概览部分的正文内容足够长，方便被正文提取器识别并保留下来。</p>",
        "<h2>安装</h2>",
        "<p>安装步骤第一段内容足够长，适合被 heading_range 选中。</p>",
        "<p>安装步骤第二段内容同样足够长，用于验证同一标题块会连续提取。</p>",
        "<h2>配置</h2>",
        "<p>配置部分正文。</p>",
        "</main>",
        "</body></html>",
      ].join(""),
    });
    const toolset = createGlobalToolset();

    const result = await toolset.web_fetch.execute({
      heading: "安装",
      mode: "heading_range",
      url: "https://example.com/docs/install",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        success: true,
        mode: "heading_range",
        selectedBlockCount: 3,
        selectedBlockStart: 3,
        title: "教程",
        url: "https://example.com/docs/install",
      },
    });
    expect((result.data as { content: string }).content).toContain("安装");
    expect((result.data as { content: string }).content).toContain("安装步骤第一段");
    expect((result.data as { content: string }).content).not.toContain("概览部分");
    expect((result.data as { content: string }).content).not.toContain("配置部分");
  });

  it("web_fetch 可提取结构化链接和表格", async () => {
    mockForwardProviderRequestViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {},
      body: [
        "<html><head><title>资料页</title></head><body>",
        "<main>",
        "<p>这是一段足够长的资料页正文，用于保证正文抽取结果不为空。</p>",
        '<a href="/guide">指南</a>',
        '<a href="https://example.com/guide">指南重复</a>',
        '<a href="mailto:team@example.com">邮件</a>',
        "<table>",
        "<caption>平台对比</caption>",
        "<thead><tr><th>平台</th><th>特征</th></tr></thead>",
        "<tbody>",
        "<tr><td>A站</td><td>强钩子</td></tr>",
        "<tr><td>B站</td><td>快节奏</td></tr>",
        "</tbody>",
        "</table>",
        "</main>",
        "</body></html>",
      ].join(""),
    });
    const toolset = createGlobalToolset();

    const result = await toolset.web_fetch.execute({
      includeLinks: true,
      includeTables: true,
      url: "https://example.com/articles/report",
    });

    expect(result).toMatchObject({
      ok: true,
      summary:
        "已读取网页《资料页》。 正文长度：28 字符。 结构化链接：1 条。 结构化表格：1 个。 当前结果为完整抽取正文。",
      data: {
        links: [{ text: "指南", url: "https://example.com/guide" }],
        tables: [
          {
            caption: "平台对比",
            headers: ["平台", "特征"],
            rows: [
              ["A站", "强钩子"],
              ["B站", "快节奏"],
            ],
          },
        ],
      },
    });
  });

  it("web_search 会在前一个实例失败后自动切换到下一个实例", async () => {
    mockForwardProviderRequestViaTauri
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {},
        body: "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {},
        body: [
          '<article class="result">',
          '<h3><a href="https://example.com/post-2">第二条结果</a></h3>',
          '<p class="content">第二条摘要。</p>',
          "</article>",
        ].join(""),
      });
    const toolset = createGlobalToolset();

    const result = await toolset.web_search.execute({
      query: "AI 小说平台",
    });

    expect(mockForwardProviderRequestViaTauri).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: expect.stringContaining("https://search-a.example/search?"),
      }),
    );
    expect(mockForwardProviderRequestViaTauri).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: expect.stringContaining("https://search-b.example/search?"),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        success: true,
        instance: "https://search-b.example",
        totalCount: 1,
      },
    });
  });

  it("web_search 支持按站点过滤并去重结果", async () => {
    mockForwardProviderRequestViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {},
      body: [
        '<article class="result">',
        '<h3><a href="https://docs.example.com/post-1">官方文档结果</a></h3>',
        '<p class="content">来自官方站点。</p>',
        "</article>",
        '<article class="result">',
        '<h3><a href="https://other.example.com/post-2">第三方结果</a></h3>',
        '<p class="content">来自第三方站点。</p>',
        "</article>",
        '<article class="result">',
        '<h3><a href="https://docs.example.com/post-1">官方文档结果重复</a></h3>',
        '<p class="content">重复链接。</p>',
        "</article>",
      ].join(""),
    });
    const toolset = createGlobalToolset();

    const result = await toolset.web_search.execute({
      domains: ["docs.example.com"],
      limit: 5,
      query: "工具文档",
    });

    expect(mockForwardProviderRequestViaTauri).toHaveBeenCalledWith({
      headers: expect.objectContaining({
        Accept: "text/html,application/xhtml+xml",
      }),
      method: "GET",
      url: expect.stringContaining(
        "q=%E5%B7%A5%E5%85%B7%E6%96%87%E6%A1%A3+site%3Adocs.example.com",
      ),
    });
    expect(result).toEqual({
      ok: true,
      summary:
        "已搜索“工具文档 site:docs.example.com”，通过 https://search-a.example 返回 1 条结果。",
      data: {
        success: true,
        query: "工具文档 site:docs.example.com",
        provider: "searxng",
        instance: "https://search-a.example",
        totalCount: 1,
        results: [
          {
            url: "https://docs.example.com/post-1",
            title: "官方文档结果",
            snippet: "来自官方站点。",
            source: "https://docs.example.com/post-1",
          },
        ],
      },
    });
  });
});

describe("createLocalResourceToolset", () => {
  beforeEach(() => {
    mockCreateAgent.mockReset();
    mockCreateSkill.mockReset();
    mockCreateSkillReferenceFile.mockReset();
    mockDeleteInstalledAgent.mockReset();
    mockDeleteInstalledSkill.mockReset();
    mockReadAgentFileContent.mockReset();
    mockReadSkillFileContent.mockReset();
    mockScanInstalledAgents.mockReset();
    mockScanInstalledSkills.mockReset();
    mockWriteAgentFileContent.mockReset();
    mockWriteSkillFileContent.mockReset();
  });

  it("skill 工具可以列出本地 skills", async () => {
    const refreshSkills = vi.fn().mockResolvedValue(undefined);
    mockScanInstalledSkills.mockResolvedValue([
      {
        id: "chapter-write",
        name: "章节写作",
        description: "写作章节正文",
        sourceKind: "builtin-package",
        references: [{ path: "references/voice.md" }],
        suggestedTools: ["read_file", "write_file"],
        tags: ["chapter"],
      },
    ]);
    const toolset = createLocalResourceToolset({ refreshSkills });

    const result = await toolset.skill.execute({ action: "list" });

    expect(result).toEqual({
      ok: true,
      summary: "已读取 1 个技能",
      data: [
        {
          description: "写作章节正文",
          files: ["SKILL.md", "references/voice.md"],
          id: "chapter-write",
          name: "章节写作",
          sourceKind: "builtin-package",
          suggestedTools: ["read", "write"],
          tags: ["chapter"],
        },
      ],
    });
  });

  it("skill 工具可以读取指定文件", async () => {
    mockReadSkillFileContent.mockResolvedValue("# SKILL");
    const toolset = createLocalResourceToolset();

    const result = await toolset.skill.execute({
      action: "read",
      relativePath: "SKILL.md",
      skillId: "chapter-write",
    });

    expect(result).toEqual({ ok: true, summary: "# SKILL" });
  });

  it("agent 工具可以更新指定文件", async () => {
    const refreshAgents = vi.fn().mockResolvedValue(undefined);
    const toolset = createLocalResourceToolset({ refreshAgents });

    const result = await toolset.agent.execute({
      action: "write",
      agentId: "writer",
      content: "# AGENT",
      relativePath: "AGENTS.md",
    });

    expect(mockWriteAgentFileContent).toHaveBeenCalledWith(
      "writer",
      "AGENTS.md",
      "# AGENT",
    );
    expect(refreshAgents).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新代理 writer 的 AGENTS.md",
      data: {
        agentId: "writer",
        relativePath: "AGENTS.md",
      },
    });
  });

  it("todo 工具限制同一时间最多一个 in_progress", async () => {
    const toolset = createLocalResourceToolset();

    await expect(
      toolset.todo.execute({
        items: [
          { content: "Step A", status: "in_progress" },
          { content: "Step B", status: "in_progress" },
        ],
      }),
    ).rejects.toThrow("Only one item can be in_progress");
  });

  it("workflow_decision 工具会提交结构化判断结果", async () => {
    const onWorkflowDecision = vi.fn();
    const toolset = createLocalResourceToolset({ onWorkflowDecision });

    const result = await toolset.workflow_decision.execute({
      issues: [
        {
          message: "主角上一段刚受伤，这一段直接高速奔跑。",
          severity: "high",
          type: "continuity",
        },
      ],
      pass: false,
      reason: "当前章节连续性问题会直接影响返工分支。",
      revision_brief: "补上伤势处理和行动受限，再继续冲突场景。",
    });

    expect(onWorkflowDecision).toHaveBeenCalledWith({
      issues: [
        {
          message: "主角上一段刚受伤，这一段直接高速奔跑。",
          severity: "high",
          type: "continuity",
        },
      ],
      label: "no",
      pass: false,
      reason: "当前章节连续性问题会直接影响返工分支。",
      revision_brief: "补上伤势处理和行动受限，再继续冲突场景。",
    });
    expect(result).toEqual({
      ok: true,
      summary: "已记录判断结果：不通过，原因已记录。",
      data: {
        issues: [
          {
            message: "主角上一段刚受伤，这一段直接高速奔跑。",
            severity: "high",
            type: "continuity",
          },
        ],
        label: "no",
        pass: false,
        reason: "当前章节连续性问题会直接影响返工分支。",
        revision_brief: "补上伤势处理和行动受限，再继续冲突场景。",
      },
    });
  });
});
