import type { JSONValue } from "ai";
import { defineTool } from "../modelGateway";
import type { AgentTool, ToolResult } from "../runtime";
import { MAX_TOOL_OUTPUT_SUMMARY_CHARS, truncateTextWithMeta } from "../subagentOutput";
import type { AgentToolPromptSpec } from "./toolPromptSpecs";
import type { ToolBuilder, ToolExecutionOptions, ToolRunner } from "./types";

export type AiSdkToolOutput = {
  data?: JSONValue;
  ok: boolean;
  summary: string;
};

function isJsonPrimitive(value: unknown): value is null | boolean | number | string {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

const MAX_TOOL_DATA_STRING_CHARS = 4_000;
const MAX_TOOL_DATA_ARRAY_ITEMS = 80;
const MAX_TOOL_DATA_OBJECT_KEYS = 80;
const MAX_TOOL_DATA_DEPTH = 6;

function toJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): JSONValue | undefined {
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
      .filter((item): item is JSONValue => item !== undefined);
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
      .filter((entry): entry is readonly [string, JSONValue] => entry[1] !== undefined);
    const result = Object.fromEntries(entries) as Record<string, JSONValue>;
    if (objectEntries.length > MAX_TOOL_DATA_OBJECT_KEYS) {
      result.__truncated = `${objectEntries.length - MAX_TOOL_DATA_OBJECT_KEYS} keys omitted`;
    }
    return result as JSONValue;
  }
  return String(value);
}

// 工具内部保留 ok/summary/data 语义；进入 AI SDK 前统一压成可序列化输出。
function toAiSdkToolOutput(result: ToolResult): AiSdkToolOutput {
  const data = toJsonValue(result.data);
  const summary = truncateTextWithMeta(result.summary, MAX_TOOL_OUTPUT_SUMMARY_CHARS).text;
  return data === undefined
    ? { ok: result.ok, summary }
    : { data, ok: result.ok, summary };
}

export async function runAiSdkTool(
  runTool: ToolRunner,
  toolName: string,
  tool: AgentTool,
  input: Record<string, unknown>,
  options?: ToolExecutionOptions,
): Promise<AiSdkToolOutput> {
  return toAiSdkToolOutput(await runTool(toolName, tool, input, options));
}

// data 存在时让模型读取结构化 JSON；纯文本工具只暴露 summary，避免无意义包装。
export function toModelOutput({ output }: { output: AiSdkToolOutput }) {
  if (output.data === undefined) {
    return { type: "text" as const, value: output.summary };
  }
  return { type: "json" as const, value: output };
}

export function createAiSdkToolBuilder(
  runTool: ToolRunner,
  spec: AgentToolPromptSpec,
  resolveOptions?: (options: { toolCallId?: string }) => ToolExecutionOptions | undefined,
): ToolBuilder {
  return (toolName, tool) =>
    defineTool({
      description: spec.description,
      inputSchema: spec.inputSchema,
      toModelOutput,
      execute: async (input, options) =>
        runAiSdkTool(
          runTool,
          toolName,
          tool,
          input as unknown as Record<string, unknown>,
          resolveOptions?.({ toolCallId: options?.toolCallId }),
        ),
    });
}
