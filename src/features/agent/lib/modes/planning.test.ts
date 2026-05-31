import { describe, expect, it } from "vitest";
import {
  derivePlanningState,
  getPlanningIntervention,
  isLikelyMultiStepPrompt,
  renderPlanItems,
} from "./planning";
import type { AgentMessage } from "../types";

function buildAssistantMessage(outputSummary: string): AgentMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    author: "主代理",
    parts: [
      {
        type: "tool-call",
        toolCallId: "update-plan-1",
        toolName: "update_plan",
        status: "completed",
        inputSummary: "{\"items\":[]}",
        outputSummary,
      },
    ],
  };
}

describe("planning", () => {
  it("识别明显的多步任务请求", () => {
    expect(isLikelyMultiStepPrompt("先定位问题，再修复并跑测试")).toBe(true);
    expect(isLikelyMultiStepPrompt("解释这个函数")).toBe(false);
  });

  it("多步任务但当前没有计划时触发先规划提醒", () => {
    expect(
      getPlanningIntervention(
        { items: [], roundsSinceUpdate: 0 },
        "先定位问题，再修复并跑测试",
      ),
    ).toEqual({ reason: "multi_step_without_plan" });
  });

  it("已有计划且连续多轮未更新时触发刷新提醒，并优先于先规划提醒", () => {
    expect(
      getPlanningIntervention(
        {
          items: [{ content: "修复问题", status: "in_progress", activeForm: "正在修复问题" }],
          roundsSinceUpdate: 3,
        },
        "先定位问题，再修复并跑测试",
      ),
    ).toEqual({ reason: "stale_plan" });
  });

  it("单步任务或活跃计划时不触发提醒", () => {
    expect(getPlanningIntervention({ items: [], roundsSinceUpdate: 0 }, "解释这个函数")).toBeNull();
    expect(
      getPlanningIntervention(
        {
          items: [{ content: "阅读代码", status: "in_progress", activeForm: "正在阅读代码" }],
          roundsSinceUpdate: 1,
        },
        "继续分析",
      ),
    ).toBeNull();
  });

  it("从最近一次 update_plan 工具结果推导当前计划和未更新轮数", () => {
    const messages: AgentMessage[] = [
      {
        id: "user-1",
        role: "user",
        author: "你",
        parts: [{ type: "text", text: "先规划一下" }],
      },
      buildAssistantMessage(
        JSON.stringify({
          items: [
            { content: "Read the failing test", status: "completed", activeForm: "Reading the failing test" },
            { content: "Patch the regression", status: "in_progress", activeForm: "Patching the regression" },
          ],
          rendered: "[x] Read the failing test\n[>] Patch the regression",
        }),
      ),
      {
        id: "user-2",
        role: "user",
        author: "你",
        parts: [{ type: "text", text: "继续" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        author: "主代理",
        parts: [{ type: "text", text: "处理中" }],
      },
      {
        id: "user-3",
        role: "user",
        author: "你",
        parts: [{ type: "text", text: "再检查一次" }],
      },
    ];

    expect(derivePlanningState(messages)).toEqual({
      items: [
        { content: "Read the failing test", status: "completed", activeForm: "Reading the failing test" },
        { content: "Patch the regression", status: "in_progress", activeForm: "Patching the regression" },
      ],
      roundsSinceUpdate: 2,
    });
  });

  it("兼容 AI SDK 工具输出包装后的 update_plan 数据", () => {
    const messages: AgentMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        author: "主代理",
        parts: [
          {
            type: "tool-call",
            toolCallId: "update-plan-1",
            toolName: "update_plan",
            status: "completed",
            inputSummary: "{\"items\":[]}",
            output: {
              ok: true,
              summary: "[>] Inspect runtime",
              data: {
                items: [
                  { content: "Inspect runtime", status: "in_progress", activeForm: "Inspecting runtime" },
                ],
                rendered: "[>] Inspect runtime",
              },
            },
            outputSummary: JSON.stringify({
              ok: true,
              summary: "[>] Inspect runtime",
              data: {
                items: [
                  { content: "Inspect runtime", status: "in_progress", activeForm: "Inspecting runtime" },
                ],
              },
            }),
          },
        ],
      },
    ];

    expect(derivePlanningState(messages).items).toEqual([
      { content: "Inspect runtime", status: "in_progress", activeForm: "Inspecting runtime" },
    ]);
  });

  it("把计划渲染成稳定的状态文本", () => {
    expect(
      renderPlanItems([
        { content: "Inspect files", status: "pending", activeForm: "" },
        { content: "Implement tool", status: "in_progress", activeForm: "Implementing tool" },
        { content: "Verify result", status: "completed", activeForm: "" },
      ]),
    ).toBe(["[ ] Inspect files", "[>] Implement tool", "[x] Verify result"].join("\n"));
  });
});
