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
          matchType: "content",
          path: "章节/第一卷/第1章.md",
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
        "- 汉字数：8",
        "- 英文单词数：2",
        "- 数字数：1",
        "- 行数：4",
        "- 段落数：2",
      ].join("\n"),
      data: {
        path: "章节/第一卷/第1章.md",
        characterCount: 25,
        nonWhitespaceCharacterCount: 21,
        hanCharacterCount: 8,
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
      pass: false,
      revision_brief: "补上伤势处理和行动受限，再继续冲突场景。",
    });
    expect(result).toEqual({
      ok: true,
      summary: "已记录判断结果：不通过。",
      data: {
        issues: [
          {
            message: "主角上一段刚受伤，这一段直接高速奔跑。",
            severity: "high",
            type: "continuity",
          },
        ],
        pass: false,
        revision_brief: "补上伤势处理和行动受限，再继续冲突场景。",
      },
    });
  });
});
