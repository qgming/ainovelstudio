import { describe, expect, it } from "vitest";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { buildSystemPrompt, buildUserTurnContent } from "./promptContext";

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
    files: ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
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
});
