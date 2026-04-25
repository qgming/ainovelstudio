import type { AgentMessage, AgentPart } from "./types";

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export type PlanItem = {
  content: string;
  status: PlanItemStatus;
  activeForm: string;
  phase?: string;
};

export type PlanningState = {
  items: PlanItem[];
  roundsSinceUpdate: number;
};

export type PlanningIntervention = {
  reason: "multi_step_without_plan" | "stale_plan";
};

type TodoPayload = {
  items?: unknown;
};

function isPlanItemStatus(value: unknown): value is PlanItemStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function normalizePlanItem(value: unknown): PlanItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
  const activeForm = typeof candidate.activeForm === "string" ? candidate.activeForm.trim() : "";
  const status = isPlanItemStatus(candidate.status) ? candidate.status : "pending";
  const phaseRaw = typeof candidate.phase === "string" ? candidate.phase.trim() : "";

  if (!content) {
    return null;
  }

  const item: PlanItem = { activeForm, content, status };
  if (phaseRaw) {
    item.phase = phaseRaw;
  }
  return item;
}

function parseTodoPayload(raw: string | undefined): PlanItem[] | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as TodoPayload;
    if (!Array.isArray(parsed.items)) {
      return null;
    }
    return parsed.items.map(normalizePlanItem).filter((item): item is PlanItem => item !== null);
  } catch {
    return null;
  }
}

function getTodoItemsFromPart(part: AgentPart): PlanItem[] | null {
  if (part.type !== "tool-call" || part.toolName !== "todo" || part.status !== "completed") {
    return null;
  }

  return parseTodoPayload(part.outputSummary);
}

function countUserRounds(messages: AgentMessage[], startIndex: number) {
  return messages.slice(startIndex + 1).filter((message) => message.role === "user").length;
}

export function isLikelyMultiStepPrompt(prompt: string) {
  const normalized = prompt.trim();
  if (!normalized) {
    return false;
  }

  return /(先.*再|然后|接着|并且|同时|逐步|分步|一步步|排查|修复.*测试|修复.*验证|实现.*测试|检查.*修复|分析.*修改|多步|多个步骤|重构)/i.test(
    normalized,
  );
}

export function getPlanningIntervention(planningState: PlanningState | null | undefined, prompt: string): PlanningIntervention | null {
  if (planningState && planningState.items.length > 0 && planningState.roundsSinceUpdate >= 3) {
    return { reason: "stale_plan" };
  }

  if ((!planningState || planningState.items.length === 0) && isLikelyMultiStepPrompt(prompt)) {
    return { reason: "multi_step_without_plan" };
  }

  return null;
}

export function derivePlanningState(messages: AgentMessage[]): PlanningState {
  let items: PlanItem[] = [];
  let updateMessageIndex = -1;

  messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      const nextItems = getTodoItemsFromPart(part);
      if (!nextItems) {
        return;
      }
      items = nextItems;
      updateMessageIndex = messageIndex;
    });
  });

  if (updateMessageIndex < 0) {
    return { items: [], roundsSinceUpdate: 0 };
  }

  return {
    items,
    roundsSinceUpdate: countUserRounds(messages, updateMessageIndex),
  };
}

export function renderPlanItems(items: PlanItem[]) {
  return items
    .map((item) => {
      const marker =
        item.status === "completed"
          ? "[x]"
          : item.status === "in_progress"
            ? "[>]"
            : "[ ]";
      const phasePrefix = item.phase ? `(${item.phase}) ` : "";
      return `${marker} ${phasePrefix}${item.content}`;
    })
    .join("\n");
}
