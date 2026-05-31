import { describe, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import { validateToolCall, type ToolCall } from "@earendil-works/pi-ai";
import type { AgentTool as WorkspaceTool, ToolResult } from "../session/runtime";
import { buildPiTools } from "./buildPiTools";
import { ALL_TOOL_SPECS } from "./tool-bridge/schemas";

function makeWorkspaceTool(impl: (input: Record<string, unknown>) => ToolResult | Promise<ToolResult>): WorkspaceTool {
  return { description: "test", execute: async (input) => impl(input) };
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id: "c1", name, arguments: args };
}

describe("buildPiTools", () => {
  it("把工作区工具包成 pi AgentTool（name/label/description/parameters/execute 齐全）", () => {
    const tools = buildPiTools({
      workspaceTools: { workspace_read: makeWorkspaceTool(() => ({ ok: true, summary: "内容" })) },
      enabledToolIds: ["workspace_read"],
    });
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe("workspace_read");
    expect(typeof tool.execute).toBe("function");
    expect(tool.parameters).toBe(ALL_TOOL_SPECS.workspace_read.parameters);
  });

  it("execute: ToolResult(ok,summary) → AgentToolResult.content 文本", async () => {
    const tools = buildPiTools({
      workspaceTools: { workspace_read: makeWorkspaceTool(() => ({ ok: true, summary: "正文内容" })) },
      enabledToolIds: ["workspace_read"],
    });
    const result = await tools[0].execute("c1", { path: "a.md", mode: "full" });
    expect(result.content).toEqual([{ type: "text", text: "正文内容" }]);
    expect(result.details).toMatchObject({ ok: true, summary: "正文内容" });
  });

  it("execute: 带 data 时 content 为 JSON 串、details 含 data", async () => {
    const tools = buildPiTools({
      workspaceTools: {
        workspace_json: makeWorkspaceTool(() => ({ ok: true, summary: "已读取", data: { stage: 3 } })),
      },
      enabledToolIds: ["workspace_json"],
    });
    const result = await tools[0].execute("c1", { path: "s.json", action: "get" });
    expect(result.details).toMatchObject({ ok: true, summary: "已读取", data: { stage: 3 } });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ data: { stage: 3 } });
  });

  it("execute: ok:false → 抛错（pi 工具契约）", async () => {
    const tools = buildPiTools({
      workspaceTools: { workspace_read: makeWorkspaceTool(() => ({ ok: false, summary: "文件不存在" })) },
      enabledToolIds: ["workspace_read"],
    });
    await expect(tools[0].execute("c1", { path: "x.md" })).rejects.toThrow("文件不存在");
  });

  it("execute: 工作区工具抛错原样冒泡", async () => {
    const tools = buildPiTools({
      workspaceTools: {
        workspace_write: makeWorkspaceTool(() => {
          throw new Error("路径非法");
        }),
      },
      enabledToolIds: ["workspace_write"],
    });
    await expect(tools[0].execute("c1", { path: "a.md", content: "x" })).rejects.toThrow("路径非法");
  });

  it("onToolRequestStateChange: start/finish 都触发", async () => {
    const onState = vi.fn();
    const tools = buildPiTools({
      workspaceTools: { workspace_read: makeWorkspaceTool(() => ({ ok: true, summary: "ok" })) },
      enabledToolIds: ["workspace_read"],
      onToolRequestStateChange: onState,
    });
    await tools[0].execute("c1", { path: "a.md" });
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: "start" }));
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: "finish" }));
  });

  it("ask_user 走专用工具（label 中文 + 需要 onAskUser）", async () => {
    const tools = buildPiTools({
      workspaceTools: {},
      enabledToolIds: ["ask_user"],
      onAskUser: async () => ({ selectionMode: "single", values: [{ type: "option", id: "a", label: "甲", value: "甲" }], usedCustomInput: false }),
    });
    expect(tools[0].name).toBe("ask_user");
    expect(tools[0].label).toBe("向用户提问");
  });

  it("TypeBox schema 能通过 validateToolCall 校验合法入参（write）", () => {
    const writeTool = {
      name: "workspace_write",
      description: ALL_TOOL_SPECS.workspace_write.description,
      parameters: ALL_TOOL_SPECS.workspace_write.parameters,
    };
    const args = validateToolCall([writeTool], toolCall("workspace_write", { path: "正文/第001章.md", action: "append", content: "正文" }));
    expect(args).toMatchObject({ path: "正文/第001章.md", action: "append" });
  });

  it("TypeBox schema 默认值：缺省 action 经 Value.Default 补默认（read.mode=full）", () => {
    // pi validateToolCall 内部用 TypeBox 校验；这里直接验证 schema 的默认值定义正确。
    const filled = Value.Default(ALL_TOOL_SPECS.workspace_read.parameters, { path: "a.md" }) as { mode?: string };
    expect(filled.mode).toBe("full");
  });

  it("TypeBox schema 必填校验：write 缺 path 应被 validateToolCall 拒绝", () => {
    const writeTool = {
      name: "workspace_write",
      description: ALL_TOOL_SPECS.workspace_write.description,
      parameters: ALL_TOOL_SPECS.workspace_write.parameters,
    };
    expect(() => validateToolCall([writeTool], toolCall("workspace_write", { action: "append" }))).toThrow();
  });

  it("update_plan 带 prepareArguments（复刻 zod preprocess 归一化）", async () => {
    const captured: unknown[] = [];
    const tools = buildPiTools({
      workspaceTools: {
        update_plan: makeWorkspaceTool((input) => {
          captured.push(input);
          return { ok: true, summary: "计划已更新" };
        }),
      },
      enabledToolIds: ["update_plan"],
    });
    const tool = tools[0];
    expect(typeof tool.prepareArguments).toBe("function");
    // 直接传 items 形态应原样保留 items 字段
    const prepared = tool.prepareArguments!({ items: [{ content: "写第一章" }] }) as { items: unknown[] };
    expect(Array.isArray(prepared.items)).toBe(true);
  });
});
