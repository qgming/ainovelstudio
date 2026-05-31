import { normalizeSuggestedToolIds } from "../domain/toolDefs";
import type { PlanItem, PlanItemStatus } from "../modes/planning";

export type SkillAction =
  | "create"
  | "create_reference"
  | "delete"
  | "list"
  | "read"
  | "write";
export type AgentAction = "create" | "delete" | "list" | "read" | "write";

function normalizePlanItemStatus(value: unknown): PlanItemStatus {
  return value === "completed" || value === "in_progress" || value === "pending"
    ? value
    : "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJsonArray(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function resolveTodoItemsInput(input: unknown) {
  if (Array.isArray(input)) {
    return input;
  }

  if (!isRecord(input)) {
    return undefined;
  }

  return parseMaybeJsonArray(input.items ?? input.todos ?? input.todo);
}

function normalizePlanContent(rawContent: string) {
  const content = rawContent.trim();
  const phaseMatch = content.match(/^\(([^)]+)\)\s*(.+)$/);
  if (!phaseMatch) {
    return { content };
  }

  return {
    content: phaseMatch[2]?.trim() || content,
    phase: phaseMatch[1]?.trim(),
  };
}

export function normalizeTodoItems(input: unknown): PlanItem[] {
  const items = resolveTodoItemsInput(input);
  if (!Array.isArray(items)) {
    throw new Error("update_plan.items 必须是数组。");
  }

  const validated = items.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`update_plan.items[${index}] 必须是对象。`);
    }

    const normalizedContent = normalizePlanContent(
      String(item.content ?? item.task ?? item.title ?? item.text ?? "").trim(),
    );
    const content = normalizedContent.content;
    if (!content) {
      throw new Error(`update_plan.items[${index}].content 不能为空。`);
    }

    const phase = String(item.phase ?? normalizedContent.phase ?? "").trim();
    const result: PlanItem = {
      activeForm: String(item.activeForm ?? item.active ?? item.doing ?? "").trim(),
      content,
      status: normalizePlanItemStatus(item.status),
    };
    if (phase) {
      result.phase = phase;
    }
    return result;
  });

  const inProgressCount = validated.filter(
    (item) => item.status === "in_progress",
  ).length;
  if (inProgressCount > 1) {
    throw new Error("Only one item can be in_progress");
  }

  return validated;
}

export function normalizeTodoToolInput(input: unknown) {
  return {
    items: normalizeTodoItems(input),
  };
}

export function normalizeSkillAction(value: unknown): SkillAction {
  if (
    value === "create" ||
    value === "create_reference" ||
    value === "delete" ||
    value === "read" ||
    value === "write"
  ) {
    return value;
  }
  return "list";
}

export function normalizeAgentAction(value: unknown): AgentAction {
  if (
    value === "create" ||
    value === "delete" ||
    value === "read" ||
    value === "write"
  ) {
    return value;
  }
  return "list";
}

export function mapSkillForTool(skill: {
  description: string;
  id: string;
  name: string;
  references: Array<{ path: string }>;
  sourceKind: string;
  suggestedTools?: string[];
  tags?: string[];
}) {
  return {
    description: skill.description,
    files: ["SKILL.md", ...skill.references.map((entry) => entry.path)],
    id: skill.id,
    name: skill.name,
    sourceKind: skill.sourceKind,
    suggestedTools: normalizeSuggestedToolIds(skill.suggestedTools ?? []),
    tags: skill.tags ?? [],
  };
}

export function mapAgentForTool(agent: {
  description: string;
  files?: string[];
  id: string;
  name: string;
  role?: string;
  sourceKind: string;
  suggestedTools?: string[];
  tags?: string[];
}) {
  return {
    description: agent.description,
    files: agent.files ?? [
      "manifest.json",
      "AGENTS.md",
    ],
    id: agent.id,
    name: agent.name,
    role: agent.role,
    sourceKind: agent.sourceKind,
    suggestedTools: normalizeSuggestedToolIds(agent.suggestedTools ?? []),
    tags: agent.tags ?? [],
  };
}
