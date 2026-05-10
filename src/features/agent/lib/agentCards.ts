import type { AgentCard } from "./longformTypes";
import { MODE_CONTROL_TOOL_ID } from "./modeControl";

export const SUBAGENT_CARDS = {
  continuity: "连续性检查",
  market: "市场侦察",
  quality: "章节质检",
  state: "状态维护",
  storyAnalysis: "爆款拆解",
  style: "风格审校",
} as const;

export const BUILTIN_AGENT_CARDS: AgentCard[] = [
  {
    allowedSubagents: [
      SUBAGENT_CARDS.continuity,
      SUBAGENT_CARDS.market,
      SUBAGENT_CARDS.quality,
      SUBAGENT_CARDS.state,
      SUBAGENT_CARDS.storyAnalysis,
      SUBAGENT_CARDS.style,
    ],
    banTools: ["ask"],
    body: [
      "按目标全自动执行，主动读取资料、规划、写回、验证和维护状态。",
      "缺少普通过程选择时自行决策；遇到外部授权或高风险破坏性操作时报告阻塞项。",
    ].join("\n"),
    contextPolicyId: "autopilot",
    id: "autopilot",
    mode: "autopilot",
    modelPresetId: null,
    name: "YOLO 全自动目标",
    reasoningEffort: "xhigh",
    tools: [MODE_CONTROL_TOOL_ID, "todo", "browse", "read", "search", "web_search", "web_fetch", "fanqie_leaderboard", "skill", "task", "edit", "write", "json", "path", "word_count", "canon_query"],
    writeScopes: ["正文/", "大纲/", "设定/", ".project/runs/", ".project/chapters/", ".project/status/", ".project/canon/", ".project/style/", ".project/evals/", ".project/MEMORY/"],
  },
  {
    allowedSubagents: [
      SUBAGENT_CARDS.continuity,
      SUBAGENT_CARDS.quality,
      SUBAGENT_CARDS.state,
      SUBAGENT_CARDS.style,
    ],
    banTools: [],
    body: [
      "严格执行长篇工作流，不跳过读取、技能加载、计划、执行、验证和状态维护。",
      "任务匹配已启用 skill 时，先读取对应 SKILL.md，再进入执行阶段。",
      "每个章节任务都维护 run、章节摘要、status 和必要 canon。",
    ].join("\n"),
    contextPolicyId: "flow",
    id: "flow",
    mode: "flow",
    modelPresetId: null,
    name: "严格工作流",
    reasoningEffort: "xhigh",
    tools: [MODE_CONTROL_TOOL_ID, "ask", "todo", "browse", "read", "search", "fanqie_leaderboard", "skill", "task", "edit", "write", "json", "path", "word_count", "canon_query"],
    writeScopes: ["正文/", "大纲/", ".project/runs/", ".project/chapters/", ".project/status/", ".project/canon/", ".project/style/", ".project/evals/"],
  },
  {
    allowedSubagents: [
      SUBAGENT_CARDS.market,
      SUBAGENT_CARDS.storyAnalysis,
      SUBAGENT_CARDS.quality,
    ],
    banTools: ["write"],
    body: [
      "聚焦立项、题材、平台、读者、卖点和差异化。",
      "输出必须能指导下一步写入作品定位、剧情梗概、角色与卷纲。",
    ].join("\n"),
    contextPolicyId: "book-design",
    id: "book-design",
    mode: "book-design",
    modelPresetId: null,
    name: "长篇立项",
    reasoningEffort: "xhigh",
    tools: ["ask", "todo", "browse", "read", "search", "web_search", "web_fetch", "fanqie_leaderboard", "skill", "task", "edit", "json", "path"],
    writeScopes: [".project/README.md", ".project/MEMORY/", "设定/", "大纲/"],
  },
  {
    allowedSubagents: [SUBAGENT_CARDS.continuity, SUBAGENT_CARDS.quality],
    banTools: ["write"],
    body: [
      "聚焦卷纲、阶段冲突、升级节奏、卷末钩子和前后卷承接。",
      "卷纲和细纲由主代理串行产出，子代理只返回检查和备选材料。",
    ].join("\n"),
    contextPolicyId: "volume-plan",
    id: "volume-plan",
    mode: "volume-plan",
    modelPresetId: null,
    name: "卷纲规划",
    reasoningEffort: "xhigh",
    tools: ["ask", "todo", "browse", "read", "search", "skill", "task", "edit", "json", "path", "canon_query"],
    writeScopes: ["大纲/", ".project/status/", ".project/canon/"],
  },
  {
    allowedSubagents: [SUBAGENT_CARDS.continuity, SUBAGENT_CARDS.quality],
    banTools: [],
    body: [
      "正文由主代理串行直写，保证文风、人物声音和连续性。",
      "每章遵循 chapter-plan -> draft -> continuity-review -> style-polish -> state-maintain -> final-check。",
      "写完必须更新章节 run 记录，并推动状态维护。",
    ].join("\n"),
    contextPolicyId: "chapter-write",
    id: "chapter-write",
    mode: "chapter-write",
    modelPresetId: null,
    name: "章节生产",
    reasoningEffort: "xhigh",
    tools: ["ask", "todo", "browse", "read", "search", "skill", "task", "edit", "write", "json", "path", "word_count", "canon_query"],
    writeScopes: ["正文/", "大纲/", ".project/runs/", ".project/chapters/", ".project/status/"],
  },
  {
    allowedSubagents: [SUBAGENT_CARDS.continuity, SUBAGENT_CARDS.state],
    banTools: ["write"],
    body: [
      "检查人物状态、时间线、伏笔账本、能力边界和 canon 冲突。",
      "发现阻断性冲突时，先写明冲突证据和修正建议，再允许进入 final-check。",
    ].join("\n"),
    contextPolicyId: "continuity-review",
    id: "continuity-review",
    mode: "continuity-review",
    modelPresetId: null,
    name: "连续性审校",
    reasoningEffort: "xhigh",
    tools: ["todo", "browse", "read", "search", "skill", "task", "edit", "json", "canon_query"],
    writeScopes: [".project/evals/", ".project/status/", ".project/canon/"],
  },
  {
    allowedSubagents: [SUBAGENT_CARDS.style, SUBAGENT_CARDS.quality],
    banTools: ["write"],
    body: [
      "统一作者声音，降低 AI 味，保留剧情事实、人物意图和章节功能。",
      "默认最小修改，改表达和节奏，不改剧情走向。",
    ].join("\n"),
    contextPolicyId: "style-polish",
    id: "style-polish",
    mode: "style-polish",
    modelPresetId: null,
    name: "文风润色",
    reasoningEffort: "high",
    tools: ["todo", "browse", "read", "search", "skill", "edit", "word_count", "canon_query"],
    writeScopes: ["正文/", ".project/style/", ".project/evals/"],
  },
  {
    allowedSubagents: [SUBAGENT_CARDS.state],
    banTools: ["write"],
    body: [
      "从已完成章节抽取 CanonDelta，并用 JSON patch 更新状态真值层。",
      "即时事实写 status JSON，稳定事实写 canon，章节摘要写 chapters。",
    ].join("\n"),
    contextPolicyId: "state-maintain",
    id: "state-maintain",
    mode: "state-maintain",
    modelPresetId: null,
    name: "状态维护",
    reasoningEffort: "high",
    tools: ["todo", "browse", "read", "search", "json", "edit", "path", "canon_query"],
    writeScopes: [".project/status/", ".project/canon/", ".project/chapters/", ".project/runs/"],
  },
];

export function getBuiltinAgentCard(mode: string) {
  return BUILTIN_AGENT_CARDS.find((card) => card.mode === mode || card.id === mode) ?? null;
}

export function resolveAgentCard(
  mode: string,
  override?: Partial<AgentCard> | null,
): AgentCard | null {
  const base = getBuiltinAgentCard(mode);
  if (!base && !override) return null;
  return {
    ...(base ?? {
      allowedSubagents: [],
      banTools: [],
      body: "",
      contextPolicyId: mode,
      id: mode,
      mode: "book" as const,
      modelPresetId: null,
      name: mode,
      reasoningEffort: "xhigh" as const,
      tools: [],
      writeScopes: [],
    }),
    ...override,
  };
}

export function applyAgentCardToolPolicy(mode: string, enabledToolIds: string[]) {
  const card = resolveAgentCard(mode);
  if (!card) return enabledToolIds;
  const enabled = new Set(enabledToolIds);
  const allowed = card.tools.length > 0
    ? card.tools.filter((toolId) => enabled.has(toolId))
    : enabledToolIds;
  const banned = new Set(card.banTools);
  return allowed.filter((toolId) => !banned.has(toolId));
}
