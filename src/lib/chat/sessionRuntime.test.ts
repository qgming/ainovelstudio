import { describe, expect, it } from "vitest";
import { mergePart } from "./sessionRuntime";
import type { AgentPart } from "../agent/types";

describe("mergePart", () => {
  it("tool-result 会把结构化 output 回填到匹配的 tool-call", () => {
    const initial: AgentPart[] = [
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "call-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
    ];

    const merged = mergePart(initial, {
      type: "tool-result",
      toolName: "read_file",
      toolCallId: "call-1",
      status: "completed",
      output: { chapter: 1, title: "风雪夜" },
      outputSummary: '{"chapter":1,"title":"风雪夜"}',
    });

    expect(merged).toEqual([
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "call-1",
        status: "completed",
        inputSummary: '{"path":"章节/第一章.md"}',
        output: { chapter: 1, title: "风雪夜" },
        outputSummary: '{"chapter":1,"title":"风雪夜"}',
        validationError: undefined,
      },
    ]);
  });

  it("重复 toolCallId 时不会错误覆盖任一 tool-call", () => {
    const initial: AgentPart[] = [
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "dup-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "dup-1",
        status: "running",
        inputSummary: '{"path":"章节/第二章.md"}',
      },
    ];

    const merged = mergePart(initial, {
      type: "tool-result",
      toolName: "read_file",
      toolCallId: "dup-1",
      status: "completed",
      output: "异常结果",
      outputSummary: "异常结果",
    });

    expect(merged).toEqual([
      initial[0],
      initial[1],
      {
        type: "tool-result",
        toolName: "read_file",
        toolCallId: "dup-1",
        status: "completed",
        output: "异常结果",
        outputSummary: "异常结果",
        validationError: "匹配到多个运行中的同 ID 工具调用。",
      },
    ]);
  });

  it("toolName 不一致时保留异常结果而不是错误回填", () => {
    const initial: AgentPart[] = [
      {
        type: "tool-call",
        toolName: "read_file",
        toolCallId: "call-1",
        status: "running",
        inputSummary: '{"path":"章节/第一章.md"}',
      },
    ];

    const merged = mergePart(initial, {
      type: "tool-result",
      toolName: "write_file",
      toolCallId: "call-1",
      status: "failed",
      output: "工具名不匹配",
      outputSummary: "工具名不匹配",
    });

    expect(merged).toEqual([
      initial[0],
      {
        type: "tool-result",
        toolName: "write_file",
        toolCallId: "call-1",
        status: "failed",
        output: "工具名不匹配",
        outputSummary: "工具名不匹配",
        validationError: "toolName 与工具调用不一致。",
      },
    ]);
  });
});
