import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import { BUILTIN_TOOLS } from "./toolDefs";

// 最小后备文本，正常流程会从 AGENTS.md 文件加载完整人设
export const DEFAULT_MAIN_AGENT_MARKDOWN = [
  "# 主代理",
  "",
  "你是神笔写作客户端的写作总控Agent。优先自己完成任务，在信息充足时直接交付可用内容。",
  "默认使用简体中文，优先给成稿或结构化结论，不输出空泛方法论。",
].join("\n");

type BuildSystemPromptInput = {
  defaultAgentMarkdown?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
};

type BuildUserTurnContentInput = {
  activeFilePath: string | null;
  manualContext?: ManualTurnContextPayload | null;
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

type TaskProfile = {
  caution: string;
  label: string;
  outputHint: string;
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
  const enabledTools = BUILTIN_TOOLS.filter((tool) => enabledToolIds.includes(tool.id));

  if (enabledTools.length === 0) {
    return "- 当前未启用任何工作区工具。";
  }

  return [
    "工具使用策略：",
    "- 未知路径或未知入口时，优先使用 search_workspace_content 或 read_workspace_tree 缩小范围。",
    "- 已知准确路径且需要全文上下文时，再使用 read_file。",
    "- 小范围改动优先使用 line_edit；只有整份内容都准备好了才使用 write_file。",
    "- create_file / create_folder / rename_path / delete_path 只处理结构变更，不负责正文读取。",
    "可用工具：",
    ...enabledTools.map((tool) => `- ${tool.name}（${tool.id}）：${tool.description}`),
  ].join("\n");
}

function inferTaskProfile(prompt: string): TaskProfile {
  if (/(续写|扩写|补写|写一段|写一章|正文|场景|scene|chapter)/i.test(prompt)) {
    return {
      label: "创作/续写",
      outputHint: "优先给可直接使用的正文内容，再补极简说明。",
      caution:
        "不要凭空改动既有设定；连续性敏感处优先核对人物、时态与剧情事实。",
    };
  }

  if (/(润色|改写|重写|精修|压缩|降重|优化表达|优化文风)/i.test(prompt)) {
    return {
      label: "改写/润色",
      outputHint: "优先给修改后文本，必要时再附简短修改说明。",
      caution: "默认保留原意、信息量与文风，不要无故重置结构或删掉有效细节。",
    };
  }

  if (
    /(大纲|设定|世界观|人物卡|角色卡|策划|规划|拆纲|outline|plot|节拍)/i.test(
      prompt,
    )
  ) {
    return {
      label: "设定/规划",
      outputHint: "优先给结构化方案，如大纲、设定条目、角色卡或步骤清单。",
      caution: "保持内部逻辑闭环，避免设定互相冲突或只有概念没有落地细节。",
    };
  }

  if (/(审稿|点评|评审|review|打分|找问题|挑错)/i.test(prompt)) {
    return {
      label: "审稿/评估",
      outputHint: "优先给问题与结论，再给修改建议或风险排序。",
      caution: "聚焦真实问题，不要用空泛表扬稀释判断。",
    };
  }

  if (/(分析|总结|梳理|解释|诊断|节奏|冲突|主题|动机)/i.test(prompt)) {
    return {
      label: "分析/诊断",
      outputHint: "优先给结论、结构化观察和依据，避免先讲泛泛方法。",
      caution: "基于已知内容推断；未读取的情节与设定不要当成事实引用。",
    };
  }

  if (/(翻译|translate|本地化)/i.test(prompt)) {
    return {
      label: "翻译/转写",
      outputHint: "优先给译文或转换结果，必要时补充少量术语说明。",
      caution: "注意语气、叙述视角和专有名词的一致性。",
    };
  }

  return {
    label: "通用协作",
    outputHint: "优先给最接近用户目标的可执行结果或下一步动作。",
    caution: "如需依赖工作区事实，先最小读取再继续，不要假设未见内容。",
  };
}

function inferFileKind(activeFilePath: string | null) {
  if (!activeFilePath) {
    return "未指定";
  }

  if (/(章|chapter|scene|正文|draft)/i.test(activeFilePath)) {
    return "章节/正文稿件";
  }

  if (/(大纲|outline|plot|beats|storyline)/i.test(activeFilePath)) {
    return "大纲/剧情规划";
  }

  if (/(设定|人物|角色|世界观|资料|wiki|notes)/i.test(activeFilePath)) {
    return "设定/资料文档";
  }

  return "通用工作区文件";
}

function buildManualContextBlock(manualContext?: ManualTurnContextPayload | null) {
  if (!manualContext) {
    return null;
  }

  const blocks: string[] = [];

  if (manualContext.skills.length > 0) {
    blocks.push(
      [
        "### 手动指定技能",
        ...manualContext.skills.map((skill) => `- ${skill.name}：${skill.description}`),
      ].join("\n"),
    );
  }

  if (manualContext.agents.length > 0) {
    blocks.push(
      [
        "### 手动指定子代理",
        ...manualContext.agents.map((agent) =>
          `- ${agent.name}${agent.role ? `（${agent.role}）` : ""}：${agent.description}`,
        ),
      ].join("\n"),
    );
  }

  if (manualContext.files.length > 0) {
    blocks.push(
      [
        "### 手动指定文件",
        ...manualContext.files.map((file) =>
          [`#### ${file.name}`, `- 路径：${file.path}`, "```text", file.content, "```"].join("\n"),
        ),
      ].join("\n\n"),
    );
  }

  if (blocks.length === 0) {
    return null;
  }

  return [
    "以下资源由用户在本轮手动指定，应优先纳入分析与执行上下文。",
    ...blocks,
  ].join("\n\n");
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
    "# 主代理系统上下文",
    renderPromptSections([
      {
        key: "s01",
        title: "运行环境",
        body: "你正在 AI Novel Studio 写作软件中运行。以下是当前可用的工具、技能和子代理资源。",
      },
      {
        key: "s02",
        title: "已启用工具",
        body: buildToolPromptBlock(enabledToolIds),
      },
      {
        key: "s03",
        title: "已启用技能",
        body: skillBlock,
      },
      {
        key: "s04",
        title: "主代理人设",
        body: normalizedDefaultAgent,
      },
      {
        key: "s05",
        title: "可委派子代理目录",
        body: agentBlock,
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
          agent.toolsPreview
            ? `TOOLS.md 摘要：\n${agent.toolsPreview}`
            : "TOOLS.md 摘要：\n- 当前没有额外 TOOLS 摘要。",
          agent.memoryPreview
            ? `MEMORY.md 摘要：\n${agent.memoryPreview}`
            : "MEMORY.md 摘要：\n- 当前没有额外 MEMORY 摘要。",
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
      {
        key: "s05",
        title: "可参考技能",
        body: skillBlock,
      },
    ]),
  ]);
}

export function buildUserTurnContent({
  activeFilePath,
  manualContext,
  workspaceRootPath,
  prompt,
  subagentAnalysis,
}: BuildUserTurnContentInput) {
  const taskProfile = inferTaskProfile(prompt);
  const fileKind = inferFileKind(activeFilePath);

  return joinSections([
    "# 当前轮上下文",
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
          `- 当前文件类型：${fileKind}`,
          `- 本轮任务类型：${taskProfile.label}`,
          `- 优先输出：${taskProfile.outputHint}`,
          `- 处理提醒：${taskProfile.caution}`,
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
        title: "手动指定上下文",
        body: buildManualContextBlock(manualContext),
      },
      {
        key: "s13",
        title: "用户请求",
        body: prompt.trim(),
      },
    ]),
  ]);
}

