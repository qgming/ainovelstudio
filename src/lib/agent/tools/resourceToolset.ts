import {
  createAgent,
  deleteInstalledAgent,
  readAgentFileContent,
  scanInstalledAgents,
  writeAgentFileContent,
} from "../../agents/api";
import {
  createSkill,
  createSkillReferenceFile,
  deleteInstalledSkill,
  readSkillFileContent,
  scanInstalledSkills,
  writeSkillFileContent,
} from "../../skills/api";
import type {
  WorkflowDecisionResult,
  WorkflowReviewIssue,
} from "../../workflow/types";
import { renderPlanItems } from "../planning";
import type { AgentTool, AgentToolExecutionContext } from "../runtime";
import type {
  AskOption,
  AskSelectionMode,
  AskToolAnswer,
  AskToolAnswerValue,
  AskUserRequest,
} from "../types";
import {
  mapAgentForTool,
  mapSkillForTool,
  normalizeAgentAction,
  normalizeSkillAction,
  normalizeTodoItems,
} from "./resourceHelpers";
import {
  asPositiveInt,
  ensureString,
  getAbortContext,
  isPlainObject,
  ok,
  type LocalResourceToolContext,
} from "./shared";

type LocalResourceToolsetContext = LocalResourceToolContext & {
  onWorkflowDecision?: (decision: WorkflowDecisionResult) => void;
};

const WORKFLOW_DECISION_SEVERITIES = new Set(["low", "medium", "high"]);
const ASK_CUSTOM_OPTION_ID = "__custom__";
const ASK_CUSTOM_OPTION_LABEL = "用户输入";

function normalizeAskSelectionMode(value: unknown): AskSelectionMode {
  return value === "multiple" ? "multiple" : "single";
}

function normalizeAskOptions(value: unknown): AskOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("ask.options 必须是非空数组。");
  }

  const seenIds = new Set<string>();
  return value.map((option, index) => {
    if (!isPlainObject(option)) {
      throw new Error(`ask.options[${index}] 必须是对象。`);
    }

    const id = ensureString(option.id, `ask.options[${index}].id`);
    const label = ensureString(option.label, `ask.options[${index}].label`);
    if (id === ASK_CUSTOM_OPTION_ID) {
      throw new Error(`ask.options[${index}].id 不能使用保留值 ${ASK_CUSTOM_OPTION_ID}。`);
    }
    if (seenIds.has(id)) {
      throw new Error(`ask.options[${index}].id 不能重复。`);
    }
    seenIds.add(id);

    const description = String(option.description ?? "").trim();
    return {
      id,
      label,
      description: description || undefined,
    };
  });
}

function normalizeAskRequest(input: Record<string, unknown>): AskUserRequest {
  const selectionMode = normalizeAskSelectionMode(input.selectionMode);
  const options = [
    ...normalizeAskOptions(input.options),
    {
      id: ASK_CUSTOM_OPTION_ID,
      label: ASK_CUSTOM_OPTION_LABEL,
    },
  ];

  const minSelections = input.minSelections == null
    ? undefined
    : asPositiveInt(input.minSelections, 1);
  const maxSelections = input.maxSelections == null
    ? undefined
    : asPositiveInt(input.maxSelections, 1);

  if (selectionMode === "single") {
    if (minSelections != null && minSelections !== 1) {
      throw new Error("ask.minSelections 在单选模式下只能为 1。");
    }
    if (maxSelections != null && maxSelections !== 1) {
      throw new Error("ask.maxSelections 在单选模式下只能为 1。");
    }
  }

  if (
    selectionMode === "multiple"
    && minSelections != null
    && maxSelections != null
    && minSelections > maxSelections
  ) {
    throw new Error("ask.minSelections 不能大于 ask.maxSelections。");
  }

  return {
    title: ensureString(input.title, "ask.title"),
    description: String(input.description ?? "").trim() || undefined,
    selectionMode,
    options,
    customOptionId: ASK_CUSTOM_OPTION_ID,
    customPlaceholder: String(input.customPlaceholder ?? "").trim() || undefined,
    minSelections,
    maxSelections,
    confirmLabel: String(input.confirmLabel ?? "").trim() || undefined,
  };
}

function normalizeAskAnswer(answer: AskToolAnswer): AskToolAnswer {
  const values = answer.values.map((value): AskToolAnswerValue => ({
    ...value,
    value: value.value.trim(),
  }));

  return {
    ...answer,
    values,
    customInput: answer.customInput?.trim() || undefined,
  };
}

function summarizeAskAnswer(answer: AskToolAnswer) {
  const items = answer.values
    .map((value) => value.value.trim())
    .filter(Boolean);
  return items.join("；") || "已收到用户回答。";
}

function ensureAskInteractiveContext(
  context: Parameters<AgentTool["execute"]>[1],
): AgentToolExecutionContext & {
  interactive: {
    askUser: NonNullable<NonNullable<AgentToolExecutionContext["interactive"]>["askUser"]>;
  };
  toolCallId: string;
} {
  if (!context?.interactive?.askUser) {
    throw new Error("当前环境不支持 ask 交互。");
  }
  if (!context.toolCallId?.trim()) {
    throw new Error("ask 工具缺少 toolCallId。");
  }
  return context as AgentToolExecutionContext & {
    interactive: {
      askUser: NonNullable<NonNullable<AgentToolExecutionContext["interactive"]>["askUser"]>;
    };
    toolCallId: string;
  };
}

function normalizeWorkflowDecisionIssue(
  issue: unknown,
  index: number,
): WorkflowReviewIssue {
  if (!isPlainObject(issue)) {
    throw new Error(`workflow_decision.issues[${index}] 必须是对象。`);
  }

  const type = ensureString(issue.type, `workflow_decision.issues[${index}].type`);
  const message = ensureString(
    issue.message,
    `workflow_decision.issues[${index}].message`,
  );
  const severityValue = String(issue.severity ?? "").trim();
  const severity = WORKFLOW_DECISION_SEVERITIES.has(severityValue)
    ? (severityValue as WorkflowReviewIssue["severity"])
    : "medium";

  return {
    type,
    severity,
    message,
  };
}

function normalizeWorkflowDecision(
  input: Record<string, unknown>,
): WorkflowDecisionResult {
  if (typeof input.pass !== "boolean") {
    throw new Error("workflow_decision.pass 必须是布尔值。");
  }

  const reason = ensureString(input.reason, "workflow_decision.reason");
  if (!Array.isArray(input.issues)) {
    throw new Error("workflow_decision.issues 必须是数组。");
  }
  if (typeof input.revision_brief !== "string") {
    throw new Error("workflow_decision.revision_brief 必须是字符串。");
  }

  const issues = input.issues.map((issue, index) =>
    normalizeWorkflowDecisionIssue(issue, index),
  );

  return {
    pass: input.pass,
    label: input.pass ? "yes" : "no",
    reason,
    issues,
    revision_brief: input.revision_brief.trim(),
  };
}

export function createLocalResourceToolset({
  refreshAgents,
  refreshSkills,
  onWorkflowDecision,
}: LocalResourceToolsetContext = {}): Record<string, AgentTool> {
  const tools: Record<string, AgentTool> = {
    ask: {
      description: "向用户发起单选或多选问题，并在收到答案后继续当前轮。",
      execute: async (input, context) => {
        const resolvedContext = ensureAskInteractiveContext(context);
        const request = normalizeAskRequest(input);
        const answer = normalizeAskAnswer(
          await resolvedContext.interactive.askUser(request),
        );
        return ok(`已收到用户回答：${summarizeAskAnswer(answer)}`, answer);
      },
    },
    todo: {
      description: "更新当前会话中的待办计划",
      execute: async (input) => {
        const items = normalizeTodoItems(input.items);
        const rendered = renderPlanItems(items);
        return ok(rendered || "当前计划已清空。", {
          items,
          rendered,
        });
      },
    },
    skill: {
      description: "读取或管理本地技能资源",
      execute: async (input, context) => {
        const action = normalizeSkillAction(input.action);
        if (action === "list") {
          await refreshSkills?.();
          const skills = await scanInstalledSkills(getAbortContext(context));
          return ok(
            `已读取 ${skills.length} 个技能`,
            skills.map((skill) => mapSkillForTool(skill)),
          );
        }

        if (action === "read") {
          const skillId = ensureString(input.skillId, "skill.skillId");
          const relativePath = ensureString(
            input.relativePath,
            "skill.relativePath",
          );
          return ok(
            await readSkillFileContent(
              skillId,
              relativePath,
              getAbortContext(context),
            ),
          );
        }

        if (action === "create") {
          const nextName = ensureString(input.name, "skill.name");
          const skills = await createSkill(
            nextName,
            ensureString(input.description, "skill.description"),
          );
          await refreshSkills?.();
          const createdSkill =
            skills.find((skill) => skill.id === nextName) ??
            skills[skills.length - 1];
          return ok(
            `已创建技能 ${createdSkill?.id ?? nextName}`,
            createdSkill ? mapSkillForTool(createdSkill) : undefined,
          );
        }

        if (action === "create_reference") {
          const skillId = ensureString(input.skillId, "skill.skillId");
          const name = ensureString(input.name, "skill.name");
          await createSkillReferenceFile(skillId, name);
          await refreshSkills?.();
          return ok(`已为技能 ${skillId} 创建参考文件 ${name}.md`, {
            name: `${name}.md`,
            skillId,
          });
        }

        if (action === "write") {
          const skillId = ensureString(input.skillId, "skill.skillId");
          const relativePath = ensureString(
            input.relativePath,
            "skill.relativePath",
          );
          await writeSkillFileContent(
            skillId,
            relativePath,
            String(input.content ?? ""),
          );
          await refreshSkills?.();
          return ok(`已更新技能 ${skillId} 的 ${relativePath}`, {
            relativePath,
            skillId,
          });
        }

        const skillId = ensureString(input.skillId, "skill.skillId");
        await deleteInstalledSkill(skillId);
        await refreshSkills?.();
        return ok(`已删除技能 ${skillId}`, { skillId });
      },
    },
    agent: {
      description: "读取或管理本地代理资源",
      execute: async (input, context) => {
        const action = normalizeAgentAction(input.action);
        if (action === "list") {
          await refreshAgents?.();
          const agents = await scanInstalledAgents(getAbortContext(context));
          return ok(
            `已读取 ${agents.length} 个代理`,
            agents.map((agent) => mapAgentForTool(agent)),
          );
        }

        if (action === "read") {
          const agentId = ensureString(input.agentId, "agent.agentId");
          const relativePath = ensureString(
            input.relativePath,
            "agent.relativePath",
          );
          return ok(
            await readAgentFileContent(
              agentId,
              relativePath,
              getAbortContext(context),
            ),
          );
        }

        if (action === "create") {
          const nextName = ensureString(input.name, "agent.name");
          const agents = await createAgent(
            nextName,
            ensureString(input.description, "agent.description"),
          );
          await refreshAgents?.();
          const createdAgent =
            agents.find((agent) => agent.id === nextName) ??
            agents[agents.length - 1];
          return ok(
            `已创建代理 ${createdAgent?.id ?? nextName}`,
            createdAgent ? mapAgentForTool(createdAgent) : undefined,
          );
        }

        if (action === "write") {
          const agentId = ensureString(input.agentId, "agent.agentId");
          const relativePath = ensureString(
            input.relativePath,
            "agent.relativePath",
          );
          await writeAgentFileContent(
            agentId,
            relativePath,
            String(input.content ?? ""),
          );
          await refreshAgents?.();
          return ok(`已更新代理 ${agentId} 的 ${relativePath}`, {
            agentId,
            relativePath,
          });
        }

        const agentId = ensureString(input.agentId, "agent.agentId");
        await deleteInstalledAgent(agentId);
        await refreshAgents?.();
        return ok(`已删除代理 ${agentId}`, { agentId });
      },
    },
  };

  if (onWorkflowDecision) {
    tools.workflow_decision = {
      description: "向当前工作流判断节点提交结构化判定结果。",
      execute: async (input) => {
        const decision = normalizeWorkflowDecision(input);
        onWorkflowDecision(decision);
        return ok(
          decision.pass ? "已记录判断结果：通过，原因已记录。" : "已记录判断结果：不通过，原因已记录。",
          decision,
        );
      },
    };
  }

  return tools;
}
