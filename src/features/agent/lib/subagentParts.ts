/**
 * 子代理流式片段的快照构造与合并工具。
 * 将子代理内部的 text-delta / reasoning / tool-result 折叠成可在 UI 中渲染的 parts。
 */

import type { AgentPart } from "./types";
import { mergeToolResultPart } from "./toolParts";

/** 构造 subagent 类型的 AgentPart 快照，用于 onProgress 回调。 */
export function createSubagentSnapshot({
  detail,
  id,
  name,
  parts,
  status,
  summary,
}: {
  detail?: string;
  id: string;
  name: string;
  parts: AgentPart[];
  status: "running" | "completed" | "failed";
  summary: string;
}): Extract<AgentPart, { type: "subagent" }> {
  return {
    type: "subagent",
    id,
    name,
    status,
    summary,
    detail,
    parts: [...parts],
  };
}

/**
 * 把子代理内的新 part 折叠进现有 parts 数组：
 * - text-delta：与上一个 text 拼接
 * - reasoning：与上一个 reasoning 拼接
 * - tool-result：委托给 mergeToolResultPart
 * - 其它：直接追加
 */
export function mergeSubagentInnerParts(
  parts: AgentPart[],
  part: AgentPart,
): AgentPart[] {
  if (part.type === "text-delta") {
    const last = parts[parts.length - 1];
    if (last && last.type === "text") {
      return [...parts.slice(0, -1), { ...last, text: last.text + part.delta }];
    }
    return [...parts, { type: "text", text: part.delta }];
  }

  if (part.type === "reasoning") {
    const last = parts[parts.length - 1];
    if (last && last.type === "reasoning") {
      return [
        ...parts.slice(0, -1),
        { ...last, detail: last.detail + part.detail },
      ];
    }
    return [...parts, part];
  }

  if (part.type === "tool-result") {
    return mergeToolResultPart(parts, part);
  }

  return [...parts, part];
}
