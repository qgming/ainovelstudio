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
import { renderPlanItems } from "../planning";
import type { AgentTool } from "../runtime";
import {
  mapAgentForTool,
  mapSkillForTool,
  normalizeAgentAction,
  normalizeSkillAction,
  normalizeTodoItems,
} from "./resourceHelpers";
import {
  getAbortContext,
  type LocalResourceToolContext,
  ensureString,
  isPlainObject,
  ok,
} from "./shared";
import type {
  WorkflowDecisionResult,
  WorkflowReviewIssue,
} from "../../workflow/types";

type LocalResourceToolsetContext = LocalResourceToolContext & {
  onWorkflowDecision?: (decision: WorkflowDecisionResult) => void;
};

const WORKFLOW_DECISION_SEVERITIES = new Set(["low", "medium", "high"]);

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
