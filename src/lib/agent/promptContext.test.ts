import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { buildSystemPrompt, buildUserTurnContent } from "./promptContext";
import type { ProjectContextPayload } from "./projectContext";

function createSkill(overrides: Partial<ResolvedSkill> = {}): ResolvedSkill {
  return {
    id: "code-review",
    name: "代码审查",
    description: "用于审查代码改动的检查清单。",
    body: "# 技能正文\n\n这里是很长的完整 skill 正文。",
    effectivePrompt: "# 技能正文\n\n这里是很长的完整 skill 正文。",
    discoveredAt: 1,
    enabled: true,
    isBuiltin: true,
    rawMarkdown: "",
    references: [
      { name: "checklist.md", path: "references/checklist.md", size: 1 },
    ],
    sourceKind: "builtin-package",
    sourceLabel: "内置",
    suggestedTools: ["read_file"],
    tags: ["review"],
    validation: { errors: [], isValid: true, warnings: [] },
    ...overrides,
  };
}

function createAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "writer-agent",
    name: "续写代理",
    description: "负责续写章节。",
    body: "# writer",
    discoveredAt: 1,
    enabled: true,
    files: ["manifest.json", "AGENTS.md"],
    isBuiltin: true,
    manifestFilePath: "agents/writer/manifest.json",
    role: "续写与润色",
    sourceKind: "builtin-package",
    sourceLabel: "内置",
    suggestedTools: ["read_file"],
    tags: ["续写"],
    validation: { errors: [], isValid: true, warnings: [] },
    ...overrides,
  };
}

describe("prompt context", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("system prompt 只保留技能目录，不常驻完整 skill 正文", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledAgents: [createAgent()],
      enabledSkills: [createSkill()],
      enabledToolIds: [],
    });

    expect(system).toContain("## s03 已启用技能");
    expect(system).toContain("system 里只保留技能目录");
    expect(system).toContain("### 技能：代码审查");
    expect(system).toContain("用于审查代码改动的检查清单");
    expect(system).not.toContain("这里是很长的完整 skill 正文");
    expect(system).not.toContain("TOOLS.md");
    expect(system).not.toContain("MEMORY.md");
  });

  it("工作流模式下不注入可委派子代理目录", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledAgents: [createAgent()],
      enabledSkills: [createSkill()],
      enabledToolIds: [],
      includeAgentCatalog: false,
    });

    expect(system).not.toContain("## s05 可委派子代理目录");
    expect(system).not.toContain("### 子代理：续写代理");
  });

  it("手动指定的大文件会裁剪成摘录并提示按需读取全文", () => {
    const content = `开头内容\n${"中间内容 ".repeat(2000)}\n结尾内容`;
    const prompt = buildUserTurnContent({
      activeFilePath: "设定/人物.md",
      manualContext: {
        agents: [],
        files: [{ content, name: "人物.md", path: "设定/人物.md" }],
        skills: [],
      },
      prompt: "继续写这一章",
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(prompt).toContain("### 手动指定文件");
    expect(prompt).toContain("已裁剪摘录");
    expect(prompt).toContain("如需全文请再用 read 读取");
    expect(prompt).toContain("开头内容");
    expect(prompt).toContain("结尾内容");
    expect(prompt).toContain("…（中间省略）…");
  });

  it("用户上下文会注入当前系统日期到年月日", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T09:30:00+08:00"));

    const prompt = buildUserTurnContent({
      activeFilePath: "章节/第一章.md",
      prompt: "继续写这一章",
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(prompt).toContain("- 当前系统日期：2026年4月18日");
  });

  it("项目默认上下文会注入 .project/AGENTS.md、.project/README.md 和状态 JSON", () => {
    const projectContext: ProjectContextPayload = {
      source: "项目默认上下文",
      files: [
        {
          content: "# 项目规则\n\n先看设定再动笔。",
          name: "AGENTS.md",
          path: ".project/AGENTS.md",
        },
        {
          content: "# 项目说明\n\n核心冲突：逃出试炼场。",
          name: "README.md",
          path: ".project/README.md",
        },
        {
          content: '{"chapter": 12, "goal": "推进试炼"}',
          name: "latest-plot.json",
          path: ".project/status/latest-plot.json",
        },
      ],
    };

    const prompt = buildUserTurnContent({
      activeFilePath: "章节/第一章.md",
      projectContext,
      prompt: "继续写这一章",
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(prompt).toContain("## s14 项目默认上下文");
    expect(prompt).toContain(".project/AGENTS.md");
    expect(prompt).toContain(".project/README.md");
    expect(prompt).toContain(".project/status/latest-plot.json");
    expect(prompt).toContain("先看设定再动笔");
    expect(prompt).toContain("核心冲突：逃出试炼场");
  });
});
