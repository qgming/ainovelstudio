import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { buildRuntimeControlBlock, buildSystemPrompt, buildUserTurnContent } from "./promptContext";
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

describe("prompt context", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("system prompt 前置主代理人设，并注入 Agent OS Kernel 与任务循环", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledSkills: [createSkill()],
      enabledToolIds: [],
    });

    expect(system).toContain("## 主代理人设");
    expect(system).toContain("## Agent OS 内核");
    expect(system.indexOf("## 主代理人设")).toBeLessThan(
      system.indexOf("## Agent OS 内核"),
    );
    expect(system).toContain("Inspect");
    expect(system).toContain("Plan");
    expect(system).toContain("Verify");
    expect(system).toContain("Report");
  });

  it("system prompt 不暴露内部 section key", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledSkills: [createSkill()],
      enabledToolIds: [],
    });

    const sectionKeys = [...system.matchAll(/^## (s\d+[a-z]?)\s/gmu)].map(
      (match) => match[1],
    );
    const unique = new Set(sectionKeys);
    expect(sectionKeys).toHaveLength(unique.size);
  });

  it("runtime control 使用纯 Markdown 标题且不暴露内部 section key", () => {
    const runtime = buildRuntimeControlBlock({
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(runtime).toContain("## 程序可信元数据");
    expect(runtime).toContain("## 执行控制");
    expect(runtime).not.toContain("当前激活文件");
    expect(runtime).not.toContain("当前文件类型");
    expect(runtime).not.toContain("本轮任务类型");
    expect(runtime).not.toContain("预期输出");
    expect(runtime).not.toContain("当前提醒");
    expect(runtime).not.toMatch(/^## s\d+[a-z]?\s/gmu);
  });

  it("user material prompt 使用纯 Markdown 标题且不暴露内部 section key", () => {
    const prompt = buildUserTurnContent({
      manualContext: {
        files: [{ name: "人物.md", path: "设定/人物.md" }],
        skills: [],
      },
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(prompt).not.toContain("## 用户请求");
    expect(prompt).not.toMatch(/^## s\d+[a-z]?\s/gmu);
    expect(prompt).toContain("## 手动指定上下文");

    const sectionKeys = [...prompt.matchAll(/^## (s\d+[a-z]?)\s/gmu)].map(
      (match) => match[1],
    );
    const unique = new Set(sectionKeys);
    expect(sectionKeys).toHaveLength(unique.size);
  });

  it("system prompt 只保留技能目录，不常驻完整 skill 正文", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledSkills: [createSkill()],
      enabledToolIds: [],
    });

    expect(system).toContain("## 动态资源目录");
    expect(system).toContain("以下是当前启用的技能目录");
    expect(system).toContain("任务明显匹配时，先读取完整 SKILL.md");
    expect(system).toContain("SKILL.md");
    expect(system).toContain("### 技能：代码审查");
    expect(system).toContain("用于审查代码改动的检查清单");
    expect(system).toContain("- 可读参考：");
    expect(system).toContain("  - references/checklist.md");
    expect(system).not.toContain("这里是很长的完整 skill 正文");
    expect(system).not.toContain("TOOLS.md");
    expect(system).not.toContain("MEMORY.md");
  });

  it("系统提示词描述直接完成任务能力", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledSkills: [createSkill()],
      enabledToolIds: [],
    });

    expect(system).toContain("直接完成任务");
  });

  it("手动指定文件只注入路径，不注入正文", () => {
    const prompt = buildUserTurnContent({
      manualContext: {
        files: [{ name: "人物.md", path: "设定/人物.md" }],
        skills: [],
      },
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(prompt).toContain("### 手动指定文件");
    expect(prompt).toContain("- 设定/人物.md");
    expect(prompt).toContain("系统不会自动注入文件正文");
  });

  it("runtime control 会注入当前系统日期到年月日", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T09:30:00+08:00"));

    const runtime = buildRuntimeControlBlock({
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(runtime).toContain("- 当前系统日期：2026年4月18日");
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
          description: "最新剧情状态，通常记录当前章节、主线目标、近期事件、下一步推进方向和关键冲突。",
          name: "latest-plot.json",
          path: ".project/status/latest-plot.json",
        },
      ],
    };

    const prompt = buildUserTurnContent({
      projectContext,
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(prompt).toContain("## 项目默认上下文");
    expect(prompt).toContain(".project/AGENTS.md");
    expect(prompt).toContain(".project/README.md");
    expect(prompt).toContain(".project/status/latest-plot.json");
    expect(prompt).toContain("先看设定再动笔");
    expect(prompt).toContain("核心冲突：逃出试炼场");
    expect(prompt).toContain("仅路径提示");
    expect(prompt).toContain("最新剧情状态");
    expect(prompt).not.toContain("推进试炼");
  });

  it("book 模式渲染图书工作区契约与项目入口", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledSkills: [createSkill()],
      enabledToolIds: ["update_plan"],
      mode: "book",
    });

    expect(system).toContain("# 模式：BOOK");
    expect(system).toContain(".project/AGENTS.md");
    expect(system).toContain("按当前任务切换职责重点");
  });

  it("autopilot 模式渲染 YOLO 契约与目标上下文", () => {
    const system = buildSystemPrompt({
      defaultAgentMarkdown: "# 主代理",
      enabledSkills: [],
      enabledToolIds: ["update_plan"],
      mode: "autopilot",
      modeContext: {
        goal: "完成第一章审校并写回文件",
        iteration: 1,
      },
    });

    expect(system).toContain("# 模式：YOLO");
    expect(system).toContain("全自动目标执行");
    expect(system).toContain("完成第一章审校并写回文件");
    expect(system).toContain("第 1 轮");
    expect(system).toContain("不用 ask");
    expect(system).toContain("yolo_control");
    expect(system).toContain('action="complete"');
  });
});
