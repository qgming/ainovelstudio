import {
  createSkill,
  createSkillReferenceFile,
  deleteInstalledSkill,
  readSkillFileContent,
  scanInstalledSkills,
  writeSkillFileContent,
} from "@features/skills/api/skillApi";
import { renderPlanItems } from "../modes/planning";
import type { AgentTool, AgentToolExecutionContext } from "../session/runtime";
import type {
  AskOption,
  AskSelectionMode,
  AskToolAnswer,
  AskToolAnswerValue,
  AskUserRequest,
} from "../types";
import {
  mapSkillForTool,
  normalizeSkillAction,
  normalizeTodoToolInput,
} from "./resourceHelpers";
import {
  asPositiveInt,
  ensureString,
  getAbortContext,
  isPlainObject,
  ok,
  type LocalResourceToolContext,
} from "./shared";

type LocalResourceToolsetContext = LocalResourceToolContext;
export const ASK_CUSTOM_OPTION_ID = "__custom__";
const ASK_CUSTOM_OPTION_LABEL = "用户输入";

function normalizeAskSelectionMode(value: unknown): AskSelectionMode {
  return value === "multiple" ? "multiple" : "single";
}

function normalizeAskOptions(value: unknown): AskOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("ask_user.options 必须是非空数组。");
  }

  const seenIds = new Set<string>();
  return value.map((option, index) => {
    if (!isPlainObject(option)) {
      throw new Error(`ask_user.options[${index}] 必须是对象。`);
    }

    const id = ensureString(option.id, `ask_user.options[${index}].id`);
    const label = ensureString(option.label, `ask_user.options[${index}].label`);
    if (id === ASK_CUSTOM_OPTION_ID) {
      throw new Error(`ask_user.options[${index}].id 不能使用保留值 ${ASK_CUSTOM_OPTION_ID}。`);
    }
    if (seenIds.has(id)) {
      throw new Error(`ask_user.options[${index}].id 不能重复。`);
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

export function normalizeAskRequest(input: Record<string, unknown>): AskUserRequest {
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
      throw new Error("ask_user.minSelections 在单选模式下只能为 1。");
    }
    if (maxSelections != null && maxSelections !== 1) {
      throw new Error("ask_user.maxSelections 在单选模式下只能为 1。");
    }
  }

  if (
    selectionMode === "multiple"
    && minSelections != null
    && maxSelections != null
    && minSelections > maxSelections
  ) {
    throw new Error("ask_user.minSelections 不能大于 ask_user.maxSelections。");
  }

  return {
    title: ensureString(input.title, "ask_user.title"),
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

export function normalizeAskAnswer(answer: AskToolAnswer): AskToolAnswer {
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

export function summarizeAskAnswer(answer: AskToolAnswer) {
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
    throw new Error("当前环境不支持 ask_user 交互。");
  }
  if (!context.toolCallId?.trim()) {
    throw new Error("ask_user 工具缺少 toolCallId。");
  }
  return context as AgentToolExecutionContext & {
    interactive: {
      askUser: NonNullable<NonNullable<AgentToolExecutionContext["interactive"]>["askUser"]>;
    };
    toolCallId: string;
  };
}

export function createLocalResourceToolset({
  refreshSkills,
}: LocalResourceToolsetContext = {}): Record<string, AgentTool> {
  const tools: Record<string, AgentTool> = {
    ask_user: {
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
    update_plan: {
      description: "更新当前会话中的待办计划",
      execute: async (input) => {
        const { items } = normalizeTodoToolInput(input);
        const rendered = renderPlanItems(items);
        return ok(rendered || "当前计划已清空。", {
          items,
          rendered,
        });
      },
    },
    skill_read: {
      description: "读取本地技能资源",
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
          const skillId = ensureString(input.skillId, "skill_read.skillId");
          const relativePath = ensureString(
            input.relativePath,
            "skill_read.relativePath",
          );
          return ok(
            await readSkillFileContent(
              skillId,
              relativePath,
              getAbortContext(context),
            ),
          );
        }

        const skillId = ensureString(input.skillId, "skill_read.skillId");
        const relativePath = ensureString(
          input.relativePath,
          "skill_read.relativePath",
        );
        return ok(
          await readSkillFileContent(
            skillId,
            relativePath,
            getAbortContext(context),
          ),
        );
      },
    },
    skill_manage: {
      description: "创建、更新或删除本地技能资源",
      execute: async (input) => {
        const action = normalizeSkillAction(input.action);
        if (action === "create") {
          const nextName = ensureString(input.name, "skill_manage.name");
          const skills = await createSkill(
            nextName,
            ensureString(input.description, "skill_manage.description"),
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
          const skillId = ensureString(input.skillId, "skill_read.skillId");
          const name = ensureString(input.name, "skill_manage.name");
          await createSkillReferenceFile(skillId, name);
          await refreshSkills?.();
          return ok(`已为技能 ${skillId} 创建参考文件 ${name}.md`, {
            name: `${name}.md`,
            skillId,
          });
        }

        if (action === "write") {
          const skillId = ensureString(input.skillId, "skill_read.skillId");
          const relativePath = ensureString(
            input.relativePath,
            "skill_read.relativePath",
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

        const skillId = ensureString(input.skillId, "skill_read.skillId");
        await deleteInstalledSkill(skillId);
        await refreshSkills?.();
        return ok(`已删除技能 ${skillId}`, { skillId });
      },
    },
  };

  return tools;
}
