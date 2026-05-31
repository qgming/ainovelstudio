import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { createToolRequestId, withAbort } from "../../utils/asyncUtils";
import type { ToolResult } from "../../session/runtime";
import { MAX_TOOL_OUTPUT_SUMMARY_CHARS, truncateTextWithMeta } from "../../utils/textTruncation";
import type { BuildPiToolParams, PiToolRunnerContext, PiToolSpec } from "./types";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isJsonPrimitive(value: unknown): value is null | boolean | number | string {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

const MAX_TOOL_DATA_STRING_CHARS = 4_000;
const MAX_TOOL_DATA_ARRAY_ITEMS = 80;
const MAX_TOOL_DATA_OBJECT_KEYS = 80;
const MAX_TOOL_DATA_DEPTH = 6;

// 把任意工具 data 压成可序列化、限长、防循环的 JSON 值（从旧 output.ts 平移，保持行为一致）。
function toJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return truncateTextWithMeta(value, MAX_TOOL_DATA_STRING_CHARS).text;
  }
  if (isJsonPrimitive(value)) return value;
  if (depth >= MAX_TOOL_DATA_DEPTH) return "[MaxDepth]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const items = value
      .slice(0, MAX_TOOL_DATA_ARRAY_ITEMS)
      .map((item) => toJsonValue(item, seen, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
    if (value.length > MAX_TOOL_DATA_ARRAY_ITEMS) {
      items.push(`[Truncated ${value.length - MAX_TOOL_DATA_ARRAY_ITEMS} items]`);
    }
    return items;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const objectEntries = Object.entries(value);
    const entries = objectEntries
      .slice(0, MAX_TOOL_DATA_OBJECT_KEYS)
      .map(([key, item]) => [key, toJsonValue(item, seen, depth + 1)] as const)
      .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined);
    const result = Object.fromEntries(entries) as Record<string, JsonValue>;
    if (objectEntries.length > MAX_TOOL_DATA_OBJECT_KEYS) {
      result.__truncated = `${objectEntries.length - MAX_TOOL_DATA_OBJECT_KEYS} keys omitted`;
    }
    return result;
  }
  return String(value);
}

// 把工具内部 ToolResult（ok/summary/data）映射成 pi AgentToolResult（content/details）。
// - content：模型可读文本。纯文本工具只给 summary；带 data 的工具给 JSON 串（含 ok/summary/data）。
// - details：结构化数据，供 UI 渲染（eventAdapter 取 details 构造 tool-result part）。
// pi 约定工具失败应 throw（而非把 error 编进 content），因此 ok:false 时抛错。
function toAgentToolResult(result: ToolResult): AgentToolResult<unknown> {
  const summary = truncateTextWithMeta(result.summary, MAX_TOOL_OUTPUT_SUMMARY_CHARS).text;
  const data = toJsonValue(result.data);

  if (data === undefined) {
    return {
      content: [{ type: "text", text: summary }],
      details: { ok: result.ok, summary },
    };
  }

  const payload = { ok: result.ok, summary, data };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: payload,
  };
}

function createInteractiveContext(context: PiToolRunnerContext, toolCallId: string) {
  const askUser = context.interactive?.askUser;
  return askUser ? { askUser: (request: import("../../types").AskUserRequest) => askUser(toolCallId, request) } : undefined;
}

/**
 * 把一个工作区工具（schema-less 执行器，返回 ToolResult，失败 throw）包装成 pi AgentTool。
 *
 * - parameters：TypeBox schema（pi 用它做 validateToolCall 校验 + 强类型）。
 * - execute：pi 签名 (toolCallId, params, signal, onUpdate)。把校验后的 params 直接作为
 *   工作区工具的 input（工作区工具内部自带 ensureString/asPositiveInt 等强转，兼容）。
 * - 失败：工作区工具 throw，或返回 ok:false → 这里统一 throw，符合 pi 工具契约。
 */
export function createPiTool(params: BuildPiToolParams): AgentTool<TSchema> {
  const { toolId, spec, workspaceTool, context, label } = params;
  return {
    name: toolId,
    label,
    description: spec.description,
    parameters: spec.parameters,
    // 入参预处理（schema 校验前），复刻旧 zod preprocess 归一化逻辑。
    ...(spec.prepareArguments
      ? { prepareArguments: (args: unknown) => spec.prepareArguments!(args) as never }
      : {}),
    async execute(toolCallId, validatedParams, signal) {
      const requestId = createToolRequestId(toolId);
      const effectiveSignal = signal ?? context.abortSignal;
      context.onToolRequestStateChange?.({ requestId, status: "start" });
      try {
        const result = await withAbort(effectiveSignal, () =>
          workspaceTool.execute(validatedParams as Record<string, unknown>, {
            abortSignal: effectiveSignal,
            requestId,
            toolCallId,
            interactive: createInteractiveContext(context, toolCallId),
          }),
        );
        if (!result.ok) {
          // ok:false 视为工具失败，按 pi 约定抛错（而非把 error 塞进 content）。
          throw new Error(result.summary || `工具 ${toolId} 执行失败。`);
        }
        return toAgentToolResult(result);
      } finally {
        context.onToolRequestStateChange?.({ requestId, status: "finish" });
      }
    },
  };
}

export type { PiToolSpec };
