import type { AgentCard } from "./longformTypes";
import { YOLO_CONTROL_TOOL_ID } from "./yoloControl";

// 内置 Agent 卡片：仅保留 YOLO 全自动卡。
// 原本的 6 张长篇卡（book-design/volume-plan/chapter-write/continuity-review/
// style-polish/state-maintain）UI 未暴露、tools/banTools/writeScopes 也未被强制，
// 属于伪功能，已整体移除。
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
    tools: [
      YOLO_CONTROL_TOOL_ID,
      "update_plan",
      "workspace_browse",
      "workspace_read",
      "workspace_search",
      "workspace_grep",
      "web_search",
      "web_read",
      "leaderboard",
      "skill_read",
      "workspace_edit",
      "workspace_write",
      "workspace_path",
      "text_stats",
    ],
    writeScopes: ["正文/", "大纲/", "设定/", ".project/README.md", ".project/memory/"],
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
