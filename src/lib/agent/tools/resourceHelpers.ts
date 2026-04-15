import { normalizeSuggestedToolIds } from "../toolDefs";
import type { PlanItem, PlanItemStatus } from "../planning";

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

export function normalizeTodoItems(items: unknown): PlanItem[] {
  if (!Array.isArray(items)) {
    throw new Error("todo.items 必须是数组。");
  }

  const validated = items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`todo.items[${index}] 必须是对象。`);
    }

    const content = String(item.content ?? "").trim();
    if (!content) {
      throw new Error(`todo.items[${index}].content 不能为空。`);
    }

    return {
      activeForm: String(item.activeForm ?? "").trim(),
      content,
      status: normalizePlanItemStatus(item.status),
    };
  });

  const inProgressCount = validated.filter(
    (item) => item.status === "in_progress",
  ).length;
  if (inProgressCount > 1) {
    throw new Error("Only one item can be in_progress");
  }

  return validated;
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
      "TOOLS.md",
      "MEMORY.md",
    ],
    id: agent.id,
    name: agent.name,
    role: agent.role,
    sourceKind: agent.sourceKind,
    suggestedTools: normalizeSuggestedToolIds(agent.suggestedTools ?? []),
    tags: agent.tags ?? [],
  };
}
