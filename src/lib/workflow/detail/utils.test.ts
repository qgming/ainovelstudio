import { describe, expect, it } from "vitest";
import {
  buildHiddenMemberName,
  buildLoopDraft,
  formatDateTime,
  formatStepLinks,
  getMemberById,
  getReadableError,
  isMemberStep,
  isSameWorkspaceBinding,
  normalizeLoopValue,
  stripWorkspaceBinding,
} from "./utils";
import type {
  WorkflowStepDefinition,
  WorkflowTeamMember,
  WorkflowWorkspaceBinding,
} from "../types";

describe("workflow/detail/utils", () => {
  it("getReadableError 取 Error.message，否则用回退", () => {
    expect(getReadableError(new Error("e1"))).toBe("e1");
    expect(getReadableError("ignored")).toBe("操作失败，请重试。");
    expect(getReadableError(null, "X")).toBe("X");
  });

  it("formatDateTime 空值返回 '—'", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(0)).toBe("—");
    expect(formatDateTime(1700000000000)).toMatch(/\d/);
  });

  it("buildLoopDraft 根据 maxLoops 选模式", () => {
    expect(buildLoopDraft({ maxLoops: null })).toEqual({
      maxLoopsMode: "infinite",
      maxLoopsValue: "1",
    });
    expect(buildLoopDraft({ maxLoops: 3 })).toEqual({
      maxLoopsMode: "finite",
      maxLoopsValue: "3",
    });
  });

  it("normalizeLoopValue 解析模式与边界", () => {
    expect(normalizeLoopValue("infinite", "abc")).toBeNull();
    expect(normalizeLoopValue("finite", "5")).toBe(5);
    expect(normalizeLoopValue("finite", "abc")).toBe(1);
    expect(normalizeLoopValue("finite", "0")).toBe(1);
  });

  it("stripWorkspaceBinding & isSameWorkspaceBinding", () => {
    const a: WorkflowWorkspaceBinding = {
      workflowId: "wf-1",
      boundAt: 1,
      bookId: "b1",
      rootPath: "/r",
      bookName: "B",
    };
    const b: WorkflowWorkspaceBinding = {
      workflowId: "wf-1",
      boundAt: 1,
      bookId: "b1",
      rootPath: "/r",
      bookName: "B",
    };
    const c: WorkflowWorkspaceBinding = {
      workflowId: "wf-1",
      boundAt: 1,
      bookId: "b2",
      rootPath: "/r",
      bookName: "B",
    };
    expect(isSameWorkspaceBinding(stripWorkspaceBinding(a), stripWorkspaceBinding(b))).toBe(
      true,
    );
    expect(isSameWorkspaceBinding(stripWorkspaceBinding(a), stripWorkspaceBinding(c))).toBe(
      false,
    );
    expect(isSameWorkspaceBinding(null, null)).toBe(true);
    expect(isSameWorkspaceBinding(null, stripWorkspaceBinding(a))).toBe(false);
  });

  it("isMemberStep 类型守卫", () => {
    const agentTask = { type: "agent_task" } as WorkflowStepDefinition;
    const start = { type: "start" } as WorkflowStepDefinition;
    expect(isMemberStep(agentTask)).toBe(true);
    expect(isMemberStep(start)).toBe(false);
  });

  it("getMemberById 找不到返回 null", () => {
    const members = [{ id: "m1", name: "A" } as WorkflowTeamMember];
    expect(getMemberById(members, "m1")?.id).toBe("m1");
    expect(getMemberById(members, null)).toBeNull();
    expect(getMemberById(members, "missing")).toBeNull();
  });

  it("buildHiddenMemberName 重名时追加序号", () => {
    expect(buildHiddenMemberName("写手", [])).toBe("写手 节点");
    expect(
      buildHiddenMemberName("写手", [
        { id: "1", name: "写手 节点" } as WorkflowTeamMember,
      ]),
    ).toBe("写手 节点 2");
  });

  it("formatStepLinks 各类型分支", () => {
    const steps = [
      { id: "s1", name: "起", type: "start", nextStepId: "s2" },
      { id: "s2", name: "写", type: "agent_task", nextStepId: "s3" },
      { id: "s3", name: "判", type: "decision", trueNextStepId: "s4", falseNextStepId: null },
      { id: "s4", name: "终", type: "end", stopReason: "completed", loopBehavior: "finish" },
    ] as unknown as WorkflowStepDefinition[];

    expect(formatStepLinks(steps[0], steps)).toContain("写");
    expect(formatStepLinks(steps[2], steps)).toContain("通过/是");
    expect(formatStepLinks(steps[3], steps)).toContain("结束");
  });
});
