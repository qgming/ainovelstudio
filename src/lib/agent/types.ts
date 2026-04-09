export type AgentRunStatus = "idle" | "running" | "completed" | "failed";

export type StatusTone = "neutral" | "warning" | "success" | "danger";

export type AgentPart =
  | { type: "placeholder"; text: string }
  | { type: "text"; text: string }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning"; summary: string; detail: string; collapsed?: boolean }
  | { type: "tool-call"; toolName: string; status: AgentRunStatus; inputSummary: string; outputSummary?: string }
  | { type: "tool-result"; toolName: string; status: AgentRunStatus; outputSummary: string }
  | {
      type: "subagent";
      id: string;
      name: string;
      status: AgentRunStatus;
      summary: string;
      detail?: string;
      parts: AgentPart[];
    };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  author: string;
  parts: AgentPart[];
};

export type AgentRun = {
  id: string;
  status: AgentRunStatus;
  title: string;
  messages: AgentMessage[];
};

export function isToolLikePart(part: AgentPart) {
  return part.type === "tool-call" || part.type === "tool-result";
}

export function getRunStatusTone(status: AgentRunStatus): StatusTone {
  if (status === "running") {
    return "warning";
  }

  if (status === "completed") {
    return "success";
  }

  if (status === "failed") {
    return "danger";
  }

  return "neutral";
}
