import type { AskToolAnswer, AskUserRequest, AgentPart } from "../types";
import { withAbort } from "./asyncUtils";

type AskUserHandler = (event: {
  request: AskUserRequest;
  toolCallId: string;
}) => Promise<AskToolAnswer>;

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function buildAskPart(
  request: AskUserRequest,
  toolCallId: string,
  status: "awaiting_user" | "completed" | "failed",
  extra?: Partial<Extract<AgentPart, { type: "ask-user" }>>,
): AgentPart {
  return {
    type: "ask-user",
    toolName: "ask_user",
    toolCallId,
    status,
    title: request.title,
    description: request.description,
    selectionMode: request.selectionMode,
    options: request.options,
    customOptionId: request.customOptionId,
    customPlaceholder: request.customPlaceholder,
    minSelections: request.minSelections,
    maxSelections: request.maxSelections,
    confirmLabel: request.confirmLabel,
    ...extra,
  };
}

export function createScopedAskUser(params: {
  abortSignal?: AbortSignal;
  enqueuePart: (part: AgentPart) => void;
  onAskUser?: AskUserHandler;
}) {
  const { abortSignal, enqueuePart, onAskUser } = params;
  let pendingToolCallId: string | null = null;

  return async function askUser(
    toolCallId: string | undefined,
    request: AskUserRequest,
  ): Promise<AskToolAnswer> {
    if (!toolCallId?.trim()) throw new Error("ask_user 工具缺少 toolCallId，无法建立交互。");
    if (!onAskUser) throw new Error("当前运行环境不支持 ask_user 交互。");
    if (pendingToolCallId && pendingToolCallId !== toolCallId) {
      throw new Error("当前已有等待用户回答的 ask_user，暂不支持并发交互。");
    }

    pendingToolCallId = toolCallId;
    enqueuePart(buildAskPart(request, toolCallId, "awaiting_user"));

    try {
      const answer = await withAbort(abortSignal, () => onAskUser({ request, toolCallId }));
      enqueuePart(buildAskPart(request, toolCallId, "completed", { answer }));
      return answer;
    } catch (error) {
      enqueuePart(buildAskPart(request, toolCallId, "failed", {
        errorMessage: isAbortError(error)
          ? "等待用户输入的交互已中断，请重新发起。"
          : getErrorMessage(error, "等待用户输入时发生未知错误。"),
      }));
      throw error;
    } finally {
      if (pendingToolCallId === toolCallId) pendingToolCallId = null;
    }
  };
}
