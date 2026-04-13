import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReadAgentFileContent,
  mockCreateWorkspaceDirectory,
  mockCreateWorkspaceTextFile,
  mockDeleteWorkspaceEntry,
  mockMoveWorkspaceEntry,
  mockReadSkillFileContent,
  mockReadWorkspaceTextFile,
  mockReadWorkspaceTextLine,
  mockReadWorkspaceTree,
  mockRenameWorkspaceEntry,
  mockReplaceWorkspaceTextLine,
  mockScanInstalledAgents,
  mockScanInstalledSkills,
  mockSearchWorkspaceContent,
  mockWriteWorkspaceTextFile,
} = vi.hoisted(() => ({
  mockReadAgentFileContent: vi.fn(),
  mockCreateWorkspaceDirectory: vi.fn(),
  mockCreateWorkspaceTextFile: vi.fn(),
  mockDeleteWorkspaceEntry: vi.fn(),
  mockMoveWorkspaceEntry: vi.fn(),
  mockReadSkillFileContent: vi.fn(),
  mockReadWorkspaceTextFile: vi.fn(),
  mockReadWorkspaceTextLine: vi.fn(),
  mockReadWorkspaceTree: vi.fn(),
  mockRenameWorkspaceEntry: vi.fn(),
  mockReplaceWorkspaceTextLine: vi.fn(),
  mockScanInstalledAgents: vi.fn(),
  mockScanInstalledSkills: vi.fn(),
  mockSearchWorkspaceContent: vi.fn(),
  mockWriteWorkspaceTextFile: vi.fn(),
}));

vi.mock("../bookWorkspace/api", () => ({
  createWorkspaceDirectory: mockCreateWorkspaceDirectory,
  createWorkspaceTextFile: mockCreateWorkspaceTextFile,
  deleteWorkspaceEntry: mockDeleteWorkspaceEntry,
  moveWorkspaceEntry: mockMoveWorkspaceEntry,
  readWorkspaceTextFile: mockReadWorkspaceTextFile,
  readWorkspaceTextLine: mockReadWorkspaceTextLine,
  readWorkspaceTree: mockReadWorkspaceTree,
  renameWorkspaceEntry: mockRenameWorkspaceEntry,
  replaceWorkspaceTextLine: mockReplaceWorkspaceTextLine,
  searchWorkspaceContent: mockSearchWorkspaceContent,
  writeWorkspaceTextFile: mockWriteWorkspaceTextFile,
}));

vi.mock("../agents/api", () => ({
  readAgentFileContent: mockReadAgentFileContent,
  scanInstalledAgents: mockScanInstalledAgents,
}));

vi.mock("../skills/api", () => ({
  readSkillFileContent: mockReadSkillFileContent,
  scanInstalledSkills: mockScanInstalledSkills,
}));

import { createLocalResourceToolset, createWorkspaceToolset } from "./tools";

describe("createWorkspaceToolset", () => {
  beforeEach(() => {
    mockCreateWorkspaceDirectory.mockReset();
    mockCreateWorkspaceTextFile.mockReset();
    mockDeleteWorkspaceEntry.mockReset();
    mockMoveWorkspaceEntry.mockReset();
    mockReadAgentFileContent.mockReset();
    mockReadSkillFileContent.mockReset();
    mockReadWorkspaceTextFile.mockReset();
    mockReadWorkspaceTextLine.mockReset();
    mockReadWorkspaceTree.mockReset();
    mockRenameWorkspaceEntry.mockReset();
    mockReplaceWorkspaceTextLine.mockReset();
    mockScanInstalledAgents.mockReset();
    mockScanInstalledSkills.mockReset();
    mockSearchWorkspaceContent.mockReset();
    mockWriteWorkspaceTextFile.mockReset();
  });

  it("写入文件后会触发工作区刷新回调", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";

    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockWriteWorkspaceTextFile.mockResolvedValue(undefined);

    const result = await toolset.write_file.execute({
      path: "章节/第一章.md",
      contents: "新内容",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(rootPath, "章节/第一章.md", "新内容", undefined);
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, summary: "已写入 章节/第一章.md" });
  });

  it("内容搜索会返回结构化命中结果", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    const matches = [
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
    ];
    mockSearchWorkspaceContent.mockResolvedValue(matches);

    const result = await toolset.search_workspace_content.execute({ query: "钟声", limit: 5 });

    expect(mockSearchWorkspaceContent).toHaveBeenCalledWith(rootPath, "钟声", 5, undefined);
    expect(result).toEqual({
      ok: true,
      summary: [
        "共找到 2 条与“钟声”相关的结果：",
        "- [文件夹] 设定/人物档案",
        "- [内容] 章节/第一卷/第1章.md:12 主角在雪夜第一次听见钟声。",
      ].join("\n"),
      data: matches,
    });
  });

  it("行编辑在替换时会更新指定行并触发刷新", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReplaceWorkspaceTextLine.mockResolvedValue({
      lineNumber: 8,
      path: "章节/第一卷/第1章.md",
      text: "新的行内容",
    });

    const result = await toolset.line_edit.execute({
      action: "replace",
      contents: "新的行内容",
      lineNumber: 8,
      nextLine: "下一行内容",
      path: "章节/第一卷/第1章.md",
      previousLine: "上一行内容",
    });

    expect(mockReplaceWorkspaceTextLine).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      8,
      "新的行内容",
      {
        nextLine: "下一行内容",
        previousLine: "上一行内容",
      },
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新 章节/第一卷/第1章.md 第 8 行：新的行内容",
      data: {
        lineNumber: 8,
        path: "章节/第一卷/第1章.md",
        text: "新的行内容",
      },
    });
  });

  it("行读取支持任意正整数行号", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    mockReadWorkspaceTextLine.mockResolvedValue({
      lineNumber: 99,
      path: "章节/第一卷/第1章.md",
      text: "",
    });

    const result = await toolset.line_edit.execute({
      action: "get",
      lineNumber: 99,
      path: "章节/第一卷/第1章.md",
    });

    expect(mockReadWorkspaceTextLine).toHaveBeenCalledWith(rootPath, "章节/第一卷/第1章.md", 99, undefined);
    expect(result).toEqual({
      ok: true,
      summary: "章节/第一卷/第1章.md 第 99 行：(空行)",
      data: {
        lineNumber: 99,
        path: "章节/第一卷/第1章.md",
        text: "",
      },
    });
  });

  it("rename 工具支持文件夹或文件重命名", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockRenameWorkspaceEntry.mockResolvedValue("章节/序章.md");

    const result = await toolset.rename.execute({
      nextName: "序章.md",
      path: "章节/第一章.md",
    });

    expect(mockRenameWorkspaceEntry).toHaveBeenCalledWith(rootPath, "章节/第一章.md", "序章.md", undefined);
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已重命名为 章节/序章.md",
    });
  });

  it("move_path 工具支持迁移文件或文件夹到指定目录", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockMoveWorkspaceEntry.mockResolvedValue("归档/第一卷/第001章.md");

    const result = await toolset.move_path.execute({
      path: "草稿/第001章.md",
      targetParentPath: "归档/第一卷",
    });

    expect(mockMoveWorkspaceEntry).toHaveBeenCalledWith(
      rootPath,
      "草稿/第001章.md",
      "归档/第一卷",
      undefined,
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已迁移到 归档/第一卷/第001章.md",
    });
  });

  it("资源工具可以列出本地 skills", async () => {
    const refreshSkills = vi.fn().mockResolvedValue(undefined);
    mockScanInstalledSkills.mockResolvedValue([
      {
        id: "chapter-write",
        name: "章节写作",
        description: "写作章节正文",
        sourceKind: "builtin-package",
        references: [{ path: "references/voice.md" }],
      },
    ]);
    const toolset = createLocalResourceToolset({ refreshSkills });

    const result = await toolset.list_skills.execute({});

    expect(refreshSkills).toHaveBeenCalledTimes(1);
    expect(mockScanInstalledSkills).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已读取 1 个技能",
      data: [
        {
          id: "chapter-write",
          name: "章节写作",
          description: "写作章节正文",
          sourceKind: "builtin-package",
          files: ["SKILL.md", "references/voice.md"],
        },
      ],
    });
  });

  it("资源工具可以读取指定 skill 文件", async () => {
    mockReadSkillFileContent.mockResolvedValue("# SKILL");
    const toolset = createLocalResourceToolset();

    const result = await toolset.read_skill_file.execute({
      skillId: "chapter-write",
      relativePath: "SKILL.md",
    });

    expect(mockReadSkillFileContent).toHaveBeenCalledWith("chapter-write", "SKILL.md", undefined);
    expect(result).toEqual({
      ok: true,
      summary: "# SKILL",
    });
  });

  it("资源工具可以列出本地 agents", async () => {
    const refreshAgents = vi.fn().mockResolvedValue(undefined);
    mockScanInstalledAgents.mockResolvedValue([
      {
        id: "writer",
        name: "写作代理",
        description: "负责续写章节",
        sourceKind: "installed-package",
      },
    ]);
    const toolset = createLocalResourceToolset({ refreshAgents });

    const result = await toolset.list_agents.execute({});

    expect(refreshAgents).toHaveBeenCalledTimes(1);
    expect(mockScanInstalledAgents).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已读取 1 个代理",
      data: [
        {
          id: "writer",
          name: "写作代理",
          description: "负责续写章节",
          sourceKind: "installed-package",
          files: ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
        },
      ],
    });
  });

  it("资源工具可以读取指定 agent 文件", async () => {
    mockReadAgentFileContent.mockResolvedValue("# AGENT");
    const toolset = createLocalResourceToolset();

    const result = await toolset.read_agent_file.execute({
      agentId: "writer",
      relativePath: "AGENTS.md",
    });

    expect(mockReadAgentFileContent).toHaveBeenCalledWith("writer", "AGENTS.md", undefined);
    expect(result).toEqual({
      ok: true,
      summary: "# AGENT",
    });
  });

  it("todo 工具会校验并返回当前会话计划", async () => {
    const toolset = createLocalResourceToolset();

    const result = await toolset.todo.execute({
      items: [
        { content: "Read the failing test", status: "completed" },
        { content: "Patch the regression", status: "in_progress", activeForm: "Patching the regression" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      summary: ["[x] Read the failing test", "[>] Patch the regression"].join("\n"),
      data: {
        items: [
          { content: "Read the failing test", status: "completed", activeForm: "" },
          { content: "Patch the regression", status: "in_progress", activeForm: "Patching the regression" },
        ],
        rendered: ["[x] Read the failing test", "[>] Patch the regression"].join("\n"),
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
});
