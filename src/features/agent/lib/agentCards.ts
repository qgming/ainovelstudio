import type { AgentCard } from "./longformTypes";
import { YOLO_CONTROL_TOOL_ID } from "./yoloControl";

export const BUILTIN_AGENT_CARDS: AgentCard[] = [
  {
    banTools: [],
    body: [
      "按目标全自动执行，主动读取资料、规划、写回、验证和维护状态。",
      "缺少普通过程选择时自行决策；遇到外部授权或高风险破坏性操作时报告阻塞项。",
    ].join("\n"),
    contextPolicyId: "autopilot",
    id: "autopilot",
    mode: "autopilot",
    modelPresetId: null,
    name: "YOLO 全自动目标",
    tools: [YOLO_CONTROL_TOOL_ID, "update_plan", "workspace_browse", "workspace_read", "workspace_search", "web_search", "web_read", "leaderboard", "skill_read", "workspace_edit", "workspace_write", "workspace_json", "workspace_path", "workspace_delete", "text_stats"],
    writeScopes: ["正文/", "大纲/", "设定/", ".project/README.md", ".project/status/"],
  },
  {
    banTools: [],
    body: [
      "聚焦立项、题材、平台、读者、卖点和差异化。",
      "输出必须能指导下一步写入作品定位、剧情梗概、角色与卷纲。",
    ].join("\n"),
    contextPolicyId: "book-design",
    id: "book-design",
    mode: "book-design",
    modelPresetId: null,
    name: "长篇立项",
    tools: ["ask_user", "update_plan", "workspace_browse", "workspace_read", "workspace_search", "web_search", "web_read", "leaderboard", "skill_read", "workspace_edit", "workspace_write", "workspace_json", "workspace_path", "workspace_delete"],
    writeScopes: [".project/README.md", "设定/", "大纲/", ".project/status/"],
  },
  {
    banTools: [],
    body: [
      "聚焦卷纲、阶段冲突、升级节奏、卷末钩子和前后卷承接。",
      "卷纲和细纲由主代理串行产出，必要的检查和备选材料作为计划步骤完成。",
    ].join("\n"),
    contextPolicyId: "volume-plan",
    id: "volume-plan",
    mode: "volume-plan",
    modelPresetId: null,
    name: "卷纲规划",
    tools: ["ask_user", "update_plan", "workspace_browse", "workspace_read", "workspace_search", "skill_read", "workspace_edit", "workspace_write", "workspace_json", "workspace_path", "workspace_delete"],
    writeScopes: ["大纲/", "设定/", ".project/status/"],
  },
  {
    banTools: [],
    body: [
      "正文由主代理串行直写，保证文风、人物声音和连续性。",
      "每章遵循 chapter-plan -> draft -> continuity-review -> style-polish -> state-maintain -> final-check。",
      "写完必须更新最新剧情、人物变化和连续性状态。",
    ].join("\n"),
    contextPolicyId: "chapter-write",
    id: "chapter-write",
    mode: "chapter-write",
    modelPresetId: null,
    name: "章节生产",
    tools: ["ask_user", "update_plan", "workspace_browse", "workspace_read", "workspace_search", "skill_read", "workspace_edit", "workspace_write", "workspace_json", "workspace_path", "workspace_delete", "text_stats"],
    writeScopes: ["正文/", "大纲/", ".project/status/"],
  },
  {
    banTools: [],
    body: [
      "检查人物状态、时间线、伏笔账本、能力边界和设定冲突。",
      "发现阻断性冲突时，先写明冲突证据和修正建议，再允许进入 final-check。",
    ].join("\n"),
    contextPolicyId: "continuity-review",
    id: "continuity-review",
    mode: "continuity-review",
    modelPresetId: null,
    name: "连续性审校",
    tools: ["update_plan", "workspace_browse", "workspace_read", "workspace_search", "skill_read", "workspace_edit", "workspace_write", "workspace_json"],
    writeScopes: [".project/status/", "设定/", "大纲/"],
  },
  {
    banTools: [],
    body: [
      "统一作者声音，降低 AI 味，保留剧情事实、人物意图和章节功能。",
      "默认最小修改，改表达和节奏，不改剧情走向。",
    ].join("\n"),
    contextPolicyId: "style-polish",
    id: "style-polish",
    mode: "style-polish",
    modelPresetId: null,
    name: "文风润色",
    tools: ["update_plan", "workspace_browse", "workspace_read", "workspace_search", "skill_read", "workspace_edit", "workspace_write", "text_stats"],
    writeScopes: ["正文/", ".project/README.md", ".project/status/"],
  },
  {
    banTools: [],
    body: [
      "从已完成章节抽取剧情、人物和连续性变化，并用 JSON patch 更新状态真值层。",
      "默认只写 status JSON；需要长期专题记录时再创建补充文件。",
    ].join("\n"),
    contextPolicyId: "state-maintain",
    id: "state-maintain",
    mode: "state-maintain",
    modelPresetId: null,
    name: "状态维护",
    tools: ["update_plan", "workspace_browse", "workspace_read", "workspace_search", "workspace_json", "workspace_edit", "workspace_write", "workspace_path", "workspace_delete"],
    writeScopes: [".project/status/"],
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
      banTools: [],
      body: "",
      contextPolicyId: mode,
      id: mode,
      mode: "book" as const,
      modelPresetId: null,
      name: mode,
      tools: [],
      writeScopes: [],
    }),
    ...override,
  };
}

export function applyAgentCardToolPolicy(mode: string, enabledToolIds: string[]) {
  void mode;
  return enabledToolIds;
}
