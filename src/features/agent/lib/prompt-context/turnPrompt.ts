import type { ManualTurnContextPayload } from "../manualTurnContext";
import { renderPlanItems, type PlanningIntervention, type PlanningState } from "../planning";
import type { ProjectContextPayload } from "../projectContext";
import { buildManualContextBlock, buildProjectContextBlock } from "./turnContextBlocks";
import { formatCurrentSystemDate, joinSections, renderPromptSections, type TaskProfile } from "./shared";

type BuildUserTurnContentInput = {
  activeFilePath: string | null;
  manualContext?: ManualTurnContextPayload | null;
  planningIntervention?: PlanningIntervention | null;
  planningState?: PlanningState | null;
  projectContext?: ProjectContextPayload | null;
  workspaceRootPath?: string | null;
  prompt: string;
  subagentAnalysis?: {
    agentName: string;
    text: string;
  } | null;
};

function buildPlanningStateBlock(planningState?: PlanningState | null) {
  if (!planningState || planningState.items.length === 0) {
    return null;
  }

  return [
    `- 连续未更新轮数：${planningState.roundsSinceUpdate}`,
    "当前计划：",
    renderPlanItems(planningState.items),
  ].join("\n");
}

function buildPlanningInterventionBlock(
  planningIntervention?: PlanningIntervention | null,
) {
  if (!planningIntervention) {
    return null;
  }

  if (planningIntervention.reason === "stale_plan") {
    return "提醒：当前计划已经连续几轮没有更新，可能与当前执行不再一致。继续前请先用 update_plan 刷新当前短计划。";
  }

  return "提醒：本轮请求看起来包含多个步骤。继续执行前，请先用 update_plan 写出当前短计划，并在完成关键步骤后及时更新。";
}

function inferTaskProfile(prompt: string): TaskProfile {
  if (/(续写|扩写|补写|写一段|写一章|正文|场景|scene|chapter)/i.test(prompt)) {
    return {
      label: "创作/续写",
      outputHint: "优先给可直接使用的正文内容，再补极简说明。",
      caution:
        "开始前必先读上一章正文、对应场景规划与人物资料；不要凭空改动既有设定；连续性敏感处优先核对人物、时态与剧情事实。",
    };
  }

  if (/(润色|改写|重写|精修|压缩|降重|优化表达|优化文风)/i.test(prompt)) {
    return {
      label: "改写/润色",
      outputHint: "优先给修改后文本，必要时再附简短修改说明。",
      caution: "改前必先 workspace_read 目标文件当前原文，不要凭印象改；默认保留原意、信息量与文风，不要无故重置结构或删掉有效细节。",
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
      caution: "开始前必先 workspace_browse 工作区并 workspace_read 已有大纲、人物、设定；保持内部逻辑闭环，避免设定互相冲突或只有概念没有落地细节。",
    };
  }

  if (/(审稿|点评|评审|review|打分|找问题|挑错)/i.test(prompt)) {
    return {
      label: "审稿/评估",
      outputHint: "优先给问题与结论，再给修改建议或风险排序。",
      caution: "开始前必先 workspace_read 被审对象的正文与相关设定；聚焦真实问题，不要用空泛表扬稀释判断。",
    };
  }

  if (/(分析|总结|梳理|解释|诊断|节奏|冲突|主题|动机)/i.test(prompt)) {
    return {
      label: "分析/诊断",
      outputHint: "优先给结论、结构化观察和依据，避免先讲泛泛方法。",
      caution: "开始前必先 workspace_read 被分析对象的正文或资料；基于已读内容推断，未读取的情节与设定不要当成事实引用。",
    };
  }

  if (/(翻译|translate|本地化)/i.test(prompt)) {
    return {
      label: "翻译/转写",
      outputHint: "优先给译文或转换结果，必要时补充少量术语说明。",
      caution: "翻译前必先 workspace_read 源文件全文；注意语气、叙述视角和专有名词的一致性。",
    };
  }

  return {
    label: "通用协作",
    outputHint: "优先给最接近用户目标的可执行结果或下一步动作。",
    caution: "如涉及工作区内容，先用 workspace_browse / workspace_search / workspace_read 读相关文件再继续，不要假设未见内容。",
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

export function buildUserTurnContent({
  activeFilePath,
  manualContext,
  planningIntervention,
  planningState,
  projectContext,
  workspaceRootPath,
  prompt,
  subagentAnalysis,
}: BuildUserTurnContentInput) {
  const taskProfile = inferTaskProfile(prompt);
  const fileKind = inferFileKind(activeFilePath);
  const currentSystemDate = formatCurrentSystemDate();

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
          `- 当前系统日期：${currentSystemDate}`,
          `- 当前文件类型：${fileKind}`,
          `- 本轮任务类型：${taskProfile.label}`,
          `- 优先输出：${taskProfile.outputHint}`,
          `- 处理提醒：${taskProfile.caution}`,
          "- 严格执行 s01 Agent OS 内核的任务循环：Inspect → Plan → Act → Verify → Report；Inspect 包含复用当前上下文与历史工具记录，资料不足时再调用工具。",
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
        title: "计划执行提醒",
        body: buildPlanningInterventionBlock(planningIntervention),
      },
      {
        key: "s13",
        title: "当前计划状态",
        body: buildPlanningStateBlock(planningState),
      },
      {
        key: "s14",
        title: "项目默认上下文",
        body: buildProjectContextBlock(projectContext),
      },
      {
        key: "s15",
        title: "手动指定上下文",
        body: buildManualContextBlock(manualContext),
      },
    ]),
  ]);
}
