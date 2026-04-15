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
  ok,
} from "./shared";

export function createLocalResourceToolset({
  refreshAgents,
  refreshSkills,
}: LocalResourceToolContext = {}): Record<string, AgentTool> {
  return {
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
}
