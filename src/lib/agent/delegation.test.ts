import { describe, expect, it } from "vitest";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { selectSubAgentForPrompt } from "./delegation";

function createAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "plot-agent",
    name: "剧情代理",
    description: "负责剧情推进与人物动机分析",
    role: "剧情",
    tags: ["剧情", "动机"],
    sourceLabel: "内置",
    body: "专注处理剧情与人物动机。",
    toolsPreview: "可读取章节文件",
    memoryPreview: "记住当前故事走向",
    suggestedTools: ["read_file"],
    enabled: true,
    files: ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
    sourceKind: "builtin-package",
    dispatchHint: "当用户询问剧情推进时",
    validation: { errors: [], isValid: true, warnings: [] },
    discoveredAt: Date.now(),
    isBuiltin: true,
    manifestFilePath: "agents/plot-agent/manifest.json",
    ...overrides,
  };
}

describe("subagent delegation", () => {
  it("普通请求默认不委派子代理", () => {
    const agent = createAgent();

    expect(selectSubAgentForPrompt("继续写这一章", [agent])).toBeNull();
  });

  it("命中专项任务和标签时委派子代理", () => {
    const agent = createAgent();

    expect(selectSubAgentForPrompt("帮我分析主角动机", [agent])?.id).toBe(agent.id);
  });

  it("用户明确要求代理介入时委派子代理", () => {
    const agent = createAgent();

    expect(selectSubAgentForPrompt("请让剧情代理帮我拆解这一章的冲突", [agent])?.id).toBe(agent.id);
  });

  it("续写类请求优先命中 chapter-write", () => {
    const writer = createAgent({
      id: "writer",
      name: "writer",
      description: "负责正文创作与重写",
      role: "写作",
      tags: ["正文", "重写", "润色"],
    });
    const chapterWrite = createAgent({
      id: "chapter-write",
      name: "chapter-write",
      description: "负责扫描目录并按章节批量生成正文",
      role: "续写",
      tags: ["续写", "章节", "写章节", "生成章节", "写下一章", "继续写", "写正文", "正文", "批量生成"],
    });

    expect(selectSubAgentForPrompt("续写", [writer, chapterWrite])?.id).toBe("chapter-write");
    expect(selectSubAgentForPrompt("写章节 第5-10章", [writer, chapterWrite])?.id).toBe("chapter-write");
    expect(selectSubAgentForPrompt("生成章节 ./我的小说/ 第3-5章", [writer, chapterWrite])?.id).toBe("chapter-write");
  });

  it("流水账检测类请求优先命中 quality-check", () => {
    const editor = createAgent({
      id: "editor",
      name: "editor",
      description: "负责审稿与节奏优化",
      role: "编辑",
      tags: ["审稿", "节奏", "钩子"],
    });
    const qualityCheckForBoring = createAgent({
      id: "quality-check",
      name: "quality-check",
      description: "负责逐章评估内容质量与流水账问题",
      role: "质量",
      tags: ["质量检查", "内容检查", "综合评估", "检查质量", "小说质量", "内容质量", "质量评估", "质量", "流水账检测", "检查流水账", "平淡检测", "流水账", "章节", "chapter", "评估"],
    });

    expect(selectSubAgentForPrompt("流水账检测 ./我的小说/ 第3-5章", [editor, qualityCheckForBoring])?.id).toBe("quality-check");
    expect(selectSubAgentForPrompt("帮我检测 ./我的小说/ 的流水账", [editor, qualityCheckForBoring])?.id).toBe("quality-check");
    expect(selectSubAgentForPrompt("检查一下流水账", [editor, qualityCheckForBoring])?.id).toBe("quality-check");
  });

  it("角色检查类请求优先命中 character-check", () => {
    const editor = createAgent({
      id: "editor",
      name: "editor",
      description: "负责审稿与节奏优化",
      role: "编辑",
      tags: ["审稿", "节奏", "钩子"],
    });
    const characterCheck = createAgent({
      id: "character-check",
      name: "character-check",
      description: "负责逐章检查角色质量",
      role: "角色检查",
      tags: ["角色检查", "角色", "人设检查", "人物检查", "检查角色", "角色质量", "章节", "chapter", "检查"],
    });

    expect(selectSubAgentForPrompt("角色检查 ./我的小说/ 第3-5章", [editor, characterCheck])?.id).toBe("character-check");
    expect(selectSubAgentForPrompt("帮我检查 ./我的小说/ 的角色", [editor, characterCheck])?.id).toBe("character-check");
    expect(selectSubAgentForPrompt("人设检查", [editor, characterCheck])?.id).toBe("character-check");
  });

  it("选题检查类请求优先命中 concept-check", () => {
    const editor = createAgent({
      id: "editor",
      name: "editor",
      description: "负责审稿与节奏优化",
      role: "编辑",
      tags: ["审稿", "节奏", "钩子"],
    });
    const conceptCheck = createAgent({
      id: "concept-check",
      name: "concept-check",
      description: "负责逐章检查创意与选题质量",
      role: "选题",
      tags: ["选题检查", "选题", "创意检查", "创意", "题材检查", "题材", "检查选题", "辨识度", "混搭", "书名", "章节", "chapter"],
    });

    expect(selectSubAgentForPrompt("选题检查 ./我的小说/ 第1-3章", [editor, conceptCheck])?.id).toBe("concept-check");
    expect(selectSubAgentForPrompt("帮我检查 ./我的小说/ 的选题", [editor, conceptCheck])?.id).toBe("concept-check");
    expect(selectSubAgentForPrompt("创意检查", [editor, conceptCheck])?.id).toBe("concept-check");
  });

  it("质量检查类请求优先命中 quality-check", () => {
    const editor = createAgent({
      id: "editor",
      name: "editor",
      description: "负责审稿与节奏优化",
      role: "编辑",
      tags: ["审稿", "节奏", "钩子"],
    });
    const novelReview = createAgent({
      id: "novel-review",
      name: "novel-review",
      description: "负责分批执行小说一致性与质量复核",
      role: "复核",
      tags: ["小说复核", "复核", "章节检查", "一致性检查", "质量检查", "小说质检", "角色", "时间线", "设定", "大纲", "伏笔", "文风", "开篇", "评估准备", "全文"],
    });
    const qualityCheck = createAgent({
      id: "quality-check",
      name: "quality-check",
      description: "负责逐章评估内容质量",
      role: "质量",
      tags: ["质量检查", "内容检查", "综合评估", "检查质量", "小说质量", "内容质量", "质量评估", "质量", "章节", "chapter", "评估"],
    });

    expect(selectSubAgentForPrompt("质量检查 ./我的小说/ 第3-5章", [editor, novelReview, qualityCheck])?.id).toBe("quality-check");
    expect(selectSubAgentForPrompt("帮我检查 ./我的小说/ 的质量", [editor, novelReview, qualityCheck])?.id).toBe("quality-check");
    expect(selectSubAgentForPrompt("综合评估", [editor, novelReview, qualityCheck])?.id).toBe("quality-check");
  });

  it("导出类请求优先命中 novel-export", () => {
    const writer = createAgent({
      id: "writer",
      name: "writer",
      description: "负责正文创作与重写",
      role: "写作",
      tags: ["正文", "重写", "润色"],
    });
    const novelExport = createAgent({
      id: "novel-export",
      name: "novel-export",
      description: "负责逐章导出为平台投稿格式",
      role: "导出",
      tags: ["导出", "导出小说", "小说导出", "平台格式", "投稿格式", "番茄", "起点", "晋江", "知乎盐选", "七猫", "章节", "chapter"],
    });

    expect(selectSubAgentForPrompt("导出 ./我的小说/ 番茄", [writer, novelExport])?.id).toBe("novel-export");
    expect(selectSubAgentForPrompt("导出 ./我的小说/ 第3-5章 起点", [writer, novelExport])?.id).toBe("novel-export");
    expect(selectSubAgentForPrompt("转换为平台格式", [writer, novelExport])?.id).toBe("novel-export");
  });

  it("开篇检查类请求优先命中 opening-check", () => {
    const editor = createAgent({
      id: "editor",
      name: "editor",
      description: "负责审稿与节奏优化",
      role: "编辑",
      tags: ["审稿", "节奏", "钩子"],
    });
    const openingCheck = createAgent({
      id: "opening-check",
      name: "opening-check",
      description: "负责逐章检查黄金三章质量",
      role: "开篇",
      tags: ["开篇检查", "开篇", "黄金三章", "检查开篇", "检查前三章", "前三章", "第1章", "章节", "chapter"],
    });

    expect(selectSubAgentForPrompt("开篇检查 ./我的小说/", [editor, openingCheck])?.id).toBe("opening-check");
    expect(selectSubAgentForPrompt("开篇检查 ./我的小说/ 第1-3章", [editor, openingCheck])?.id).toBe("opening-check");
    expect(selectSubAgentForPrompt("检查一下黄金三章", [editor, openingCheck])?.id).toBe("opening-check");
  });

  it("小说复核类请求优先命中 novel-review", () => {
    const editor = createAgent({
      id: "editor",
      name: "editor",
      description: "负责审稿与节奏优化",
      role: "编辑",
      tags: ["审稿", "节奏", "钩子"],
    });
    const novelReview = createAgent({
      id: "novel-review",
      name: "novel-review",
      description: "负责分批执行小说一致性与质量复核",
      role: "复核",
      tags: ["小说复核", "复核", "章节检查", "一致性检查", "质量检查", "小说质检", "角色", "时间线", "设定", "大纲", "伏笔", "文风", "开篇", "评估准备", "全文"],
    });

    expect(selectSubAgentForPrompt("小说复核 ./我的小说/ --角色", [editor, novelReview])?.id).toBe("novel-review");
    expect(selectSubAgentForPrompt("帮我复核 ./我的小说/ 第5-10章", [editor, novelReview])?.id).toBe("novel-review");
    expect(selectSubAgentForPrompt("小说质检", [editor, novelReview])?.id).toBe("novel-review");
  });

  it("大纲构建类请求优先命中 outline", () => {
    const writer = createAgent({
      id: "writer",
      name: "writer",
      description: "负责正文创作与重写",
      role: "写作",
      tags: ["正文", "重写", "润色"],
    });
    const outlineAgent = createAgent({
      id: "outline",
      name: "outline",
      description: "负责从构思期推进到完整大纲",
      role: "大纲规划",
      tags: ["构思故事", "故事概念", "帮我想一个故事", "生成大纲", "构建大纲", "写大纲", "一页纸大纲", "完整大纲", "outline"],
    });

    expect(selectSubAgentForPrompt("帮我生成大纲", [writer, outlineAgent])?.id).toBe("outline");
    expect(selectSubAgentForPrompt("我改了反派的动机，帮我重新生成大纲", [writer, outlineAgent])?.id).toBe("outline");
    expect(selectSubAgentForPrompt("写大纲", [writer, outlineAgent])?.id).toBe("outline");
  });

  it("snowflake-fiction 命令类请求优先命中 snowflake-fiction", () => {
    const chapterWrite = createAgent({
      id: "chapter-write",
      name: "chapter-write",
      description: "负责扫描目录并按章节批量生成正文",
      role: "续写",
      tags: ["续写", "章节", "写章节", "生成章节", "写下一章", "继续写", "写正文", "正文", "批量生成"],
    });
    const novelExport = createAgent({
      id: "novel-export",
      name: "novel-export",
      description: "负责逐章导出为平台投稿格式",
      role: "导出",
      tags: ["导出", "导出小说", "小说导出", "平台格式", "投稿格式", "番茄", "起点", "晋江", "知乎盐选", "七猫", "章节", "chapter"],
    });
    const snowflakeFiction = createAgent({
      id: "snowflake-fiction",
      name: "snowflake-fiction",
      description: "负责扫描小说目录、恢复雪花写作法流程并路由阶段任务",
      role: "雪花写作法",
      tags: ["/snowflake-fiction", "snowflake-fiction", "雪花写作法", "雪花法", "创作进度", "恢复创作", "继续下一步", "项目进度", "批量生成章节", "批量生成", "步骤"],
    });

    expect(selectSubAgentForPrompt("/snowflake-fiction ./我的小说/", [chapterWrite, novelExport, snowflakeFiction])?.id).toBe("snowflake-fiction");
    expect(selectSubAgentForPrompt("/snowflake-fiction 生成 第5-10章 --batch", [chapterWrite, novelExport, snowflakeFiction])?.id).toBe("snowflake-fiction");
    expect(selectSubAgentForPrompt("/snowflake-fiction", [chapterWrite, novelExport, snowflakeFiction])?.id).toBe("snowflake-fiction");
  });
});
