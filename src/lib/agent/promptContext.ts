import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { BUILTIN_TOOLS } from "./toolDefs";

export const DEFAULT_MAIN_AGENT_MARKDOWN = [
  "# 主代理",
  "",
  "你是 AI Novel Studio 的主代理，负责直接与用户对话，并统筹工作区、工具、技能与子代理能力。",
  "",
  "## 主从协作",
  "- 日常默认由主代理直接响应用户，不要把普通对话自动转交给子代理。",
  "- 只有在任务明显需要专项视角、用户明确要求，或某个启用子代理与任务高度匹配时，才委派子代理。",
  "- 子代理只提供局部分析、建议或草稿，最终结论与最终输出始终由主代理整合。",
  "",
  "## 上下文使用顺序",
  "1. 本轮用户请求与用户明确约束",
  "2. 当前轮动态上下文：激活文件、工具结果、工作区状态",
  "3. 已启用工具",
  "4. 已启用技能",
  "5. 默认 AGENTS.md",
  "6. 可委派子代理目录",
  "",
  "## 输出要求",
  "- 默认使用简体中文，优先直接给出成稿、答案、修改版或下一步动作。",
  "- 只提炼和当前任务直接相关的信息，不要机械复述整段上下文。",
  "- 当上下文不足以安全完成任务时，先指出缺口，再进行最小提问或最小读取。",
  "- 当参考了工具结果或子代理结论时，只输出整合后的判断，不输出流水账。",
].join("\n");

type BuildSystemPromptInput = {
  defaultAgentMarkdown?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
};

type BuildUserTurnContentInput = {
  activeFilePath: string | null;
  workspaceRootPath?: string | null;
  prompt: string;
  subagentAnalysis?: {
    agentName: string;
    text: string;
  } | null;
};

type PromptSection = {
  body: string | null | undefined;
  key: string;
  title: string;
};

function joinSections(sections: Array<string | null | undefined>) {
  return sections
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");
}

function renderPromptSections(sections: PromptSection[]) {
  return sections
    .filter((section) => Boolean(section.body?.trim()))
    .map((section) =>
      [`## ${section.key} ${section.title}`, section.body?.trim()]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function buildSkillPromptBlock(skill: ResolvedSkill) {
  return [
    `### 技能：${skill.name}`,
    `- 来源：${skill.sourceLabel}`,
    `- 说明：${skill.description}`,
    skill.suggestedTools.length > 0
      ? `- 推荐工具：${skill.suggestedTools.join(", ")}`
      : "- 推荐工具：无",
    skill.references.length > 0
      ? `- 参考资料：${skill.references.map((entry) => entry.path).join(", ")}`
      : null,
    "技能规则：",
    skill.effectivePrompt,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAgentCatalogBlock(agent: ResolvedAgent) {
  return [
    `### 子代理：${agent.name}`,
    `- 来源：${agent.sourceLabel}`,
    agent.role ? `- 角色：${agent.role}` : null,
    `- 说明：${agent.description}`,
    agent.dispatchHint ? `- 适用时机：${agent.dispatchHint}` : null,
    agent.tags.length > 0 ? `- 匹配标签：${agent.tags.join(", ")}` : null,
    agent.suggestedTools.length > 0
      ? `- 推荐工具：${agent.suggestedTools.join(", ")}`
      : "- 推荐工具：无",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildToolPromptBlock(enabledToolIds: string[]) {
  const enabledTools = BUILTIN_TOOLS.filter((tool) =>
    enabledToolIds.includes(tool.id),
  );

  if (enabledTools.length === 0) {
    return "- 当前未启用任何工作区工具。";
  }

  return enabledTools
    .map((tool) => `- ${tool.name}（${tool.id}）：${tool.description}`)
    .join("\n");
}

export function buildSystemPrompt({
  defaultAgentMarkdown,
  enabledAgents,
  enabledSkills,
  enabledToolIds,
}: BuildSystemPromptInput) {
  const normalizedDefaultAgent =
    defaultAgentMarkdown && defaultAgentMarkdown.trim()
      ? defaultAgentMarkdown.trim()
      : DEFAULT_MAIN_AGENT_MARKDOWN;

  const skillBlock =
    enabledSkills.length > 0
      ? enabledSkills.map((skill) => buildSkillPromptBlock(skill)).join("\n\n")
      : "- 当前未启用额外技能。";

  const agentBlock =
    enabledAgents.length > 0
      ? enabledAgents.map((agent) => buildAgentCatalogBlock(agent)).join("\n\n")
      : "- 当前没有可委派的子代理。";

  return joinSections([
    "# 主代理系统流水线",
    "以下 section 由稳定来源按顺序组装。越靠前优先级越高；后段只在与当前任务相关时参考。",
    renderPromptSections([
      {
        key: "s00",
        title: "装配顺序",
        body: [
          "1. 核心身份与响应原则",
          "2. 已启用工具",
          "3. 已启用技能",
          "4. 默认 AGENTS.md",
          "5. 可委派子代理目录",
          "6. 委派策略",
          "7. 本轮动态上下文与用户请求（见当前轮输入流水线）",
        ].join("\n"),
      },
      {
        key: "s01",
        title: "核心身份",
        body: "你是神笔写作客户端中的Agent助手。你的职责是整合用户请求、工作区上下文、工具能力、技能规则与子代理资源，并直接向用户给出最终可执行结果。",
      },
      {
        key: "s02",
        title: "响应原则",
        body: [
          "- 先遵循当前用户请求与用户明确约束。",
          "- 优先整合上下文并直接完成任务，不要机械复述资源内容。",
          "- 若上下文不足以安全完成任务，先说明缺口，再进行最小补充或最小读取。",
          "- 回答默认使用简体中文。",
        ].join("\n"),
      },
      {
        key: "s03",
        title: "已启用工具",
        body: buildToolPromptBlock(enabledToolIds),
      },
      {
        key: "s04",
        title: "已启用技能",
        body: skillBlock,
      },
      {
        key: "s05",
        title: "默认 AGENTS.md",
        body: normalizedDefaultAgent,
      },
      {
        key: "s06",
        title: "可委派子代理目录",
        body: agentBlock,
      },
      {
        key: "s07",
        title: "委派策略",
        body: [
          "- 日常默认由主代理直接响应用户。",
          "- 只有在用户明确要求、任务明显需要专项能力，或某个子代理与任务高度匹配时，才委派子代理。",
          "- 即使发生委派，也只把子代理结论当作输入材料，最终答复仍由主代理统一输出。",
        ].join("\n"),
      },
    ]),
  ]);
}

export function buildSubAgentSystem(
  agent: ResolvedAgent,
  enabledSkills: ResolvedSkill[],
) {
  const skillBlock =
    enabledSkills.length > 0
      ? enabledSkills
          .map((skill) =>
            [
              `### 技能：${skill.name}`,
              `- 说明：${skill.description}`,
              skill.suggestedTools.length > 0
                ? `- 推荐工具：${skill.suggestedTools.join(", ")}`
                : "- 推荐工具：无",
              skill.effectivePrompt,
            ].join("\n"),
          )
          .join("\n\n")
      : "- 当前没有额外技能。";

  return joinSections([
    "# 子任务执行上下文",
    renderPromptSections([
      {
        key: "s00",
        title: "执行模型",
        body: [
          "你正在替父代理执行一个一次性子任务。",
          "这是全新的独立上下文，不继承父对话 messages。",
          "你的中间过程不会自动写回父上下文，只有最终摘要会被带回。",
        ].join("\n"),
      },
      {
        key: "s01",
        title: "子任务档案",
        body: [
          `- 子任务来源：${agent.name}`,
          agent.role ? `- 专长方向：${agent.role}` : null,
          `- 任务说明：${agent.description}`,
          agent.dispatchHint ? `- 适用时机：${agent.dispatchHint}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        key: "s02",
        title: "上下文边界",
        body: [
          "- 只处理当前被拆出的局部任务，不要扩展成主任务总控。",
          "- 只使用当前提供的工具与资料，不要继续派生新的子任务。",
          "- 如果信息不足，基于现有工具做最小读取与最小验证。",
        ].join("\n"),
      },
      {
        key: "s03",
        title: "任务资料",
        body: [
          "AGENTS.md：",
          agent.body,
          agent.toolsPreview ? `TOOLS.md 摘要：\n${agent.toolsPreview}` : "TOOLS.md 摘要：\n- 当前没有额外 TOOLS 摘要。",
          agent.memoryPreview ? `MEMORY.md 摘要：\n${agent.memoryPreview}` : "MEMORY.md 摘要：\n- 当前没有额外 MEMORY 摘要。",
        ].join("\n\n"),
      },
      {
        key: "s04",
        title: "返回格式",
        body: [
          "- 只返回对子任务真正有价值的摘要、结论、建议或结果。",
          "- 不要解释你的内部执行过程，不要回放完整工具流水。",
          "- 输出将由父代理继续整合，因此优先给高密度结论。",
        ].join("\n"),
      },
      enabledSkills.length > 0
        ? {
            key: "s05",
            title: "可参考技能",
            body: skillBlock,
          }
        : {
            key: "s05",
            title: "可参考技能",
            body: "- 当前没有额外技能。",
          },
    ]),
  ]);
}

export function buildUserTurnContent({
  activeFilePath,
  workspaceRootPath,
  prompt,
  subagentAnalysis,
}: BuildUserTurnContentInput) {
  return joinSections([
    "# 当前轮输入流水线",
    "以下内容是本轮动态上下文与用户输入，只对当前轮生效。",
    "=== DYNAMIC_BOUNDARY ===",
    renderPromptSections([
      {
        key: "s10",
        title: "当前轮动态上下文",
        body: [
          workspaceRootPath
            ? `- 当前工作区：${workspaceRootPath}`
            : "- 当前没有打开工作区。",
          activeFilePath
            ? `- 当前激活文件：${activeFilePath}`
            : "- 当前没有激活文件。",
          subagentAnalysis?.text
            ? `- 本轮已收到子任务摘要：${subagentAnalysis.agentName}`
            : "- 本轮默认由主代理直接处理。",
        ].join("\n"),
      },
      subagentAnalysis?.text
        ? {
            key: "s11",
            title: `子任务摘要（${subagentAnalysis.agentName}）`,
            body: subagentAnalysis.text.trim(),
          }
        : {
            key: "s11",
            title: "子任务摘要",
            body: null,
          },
      {
        key: "s12",
        title: "用户请求",
        body: prompt.trim(),
      },
    ]),
  ]);
}


