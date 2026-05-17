import { describe, expect, it } from "vitest";
import type { AgentMessage } from "./types";
import {
  createInitialWorkflowState,
  deriveWorkflowState,
  processWorkflowControl,
  WORKFLOW_CONTROL_KIND,
  WORKFLOW_CONTROL_TOOL_ID,
  type WorkflowDefinition,
} from "./workflowControl";

const workflow: WorkflowDefinition = {
  edges: [
    { from: "inspect", id: "edge-1", to: "act" },
    { from: "act", id: "edge-2", to: "report" },
  ],
  id: "chapter-flow",
  nodes: [
    { agentCardId: "book", gate: "已读取上下文", id: "inspect", title: "读取上下文", type: "task" },
    { agentCardId: "chapter-write", gate: "已写回正文", id: "act", title: "执行写作", type: "task" },
    { agentCardId: "book", gate: "已汇报结果", id: "report", title: "汇报", type: "report" },
  ],
  title: "章节流程",
};

describe("workflowControl", () => {
  it("先生成草案并等待用户确认", () => {
    const drafted = processWorkflowControl(createInitialWorkflowState(), {
      action: "draft_workflow",
      workflow,
    });
    const approval = processWorkflowControl(drafted.state, {
      action: "request_approval",
    });

    expect(drafted.accepted).toBe(true);
    expect(drafted.state.status).toBe("draft");
    expect(approval.accepted).toBe(true);
    expect(approval.state.status).toBe("pending_approval");
  });

  it("启动后只允许完成当前节点", () => {
    const started = processWorkflowControl(createInitialWorkflowState(), {
      action: "start_workflow",
      workflow,
    });
    const rejected = processWorkflowControl(started.state, {
      action: "complete_node",
      nodeId: "act",
      evidence: ["已写回"],
    });
    const accepted = processWorkflowControl(started.state, {
      action: "complete_node",
      nodeId: "inspect",
      evidence: ["已读取 .project/AGENTS.md"],
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.missing).toContain("当前节点是 inspect，不能提交 act。");
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.currentNodeId).toBe("act");
  });

  it("支持判断分支和循环", () => {
    const branchingWorkflow: WorkflowDefinition = {
      edges: [
        { condition: "需要返修", from: "review", id: "edge-rework", to: "act" },
        { condition: "通过", from: "review", id: "edge-done", to: "report" },
      ],
      id: "branch-flow",
      nodes: [
        { agentCardId: "continuity-review", gate: "已给出审校结论", id: "review", title: "审校", type: "decision" },
        { agentCardId: "chapter-write", gate: "已返修", id: "act", title: "返修", type: "loop" },
        { agentCardId: "book", gate: "已汇报", id: "report", title: "汇报", type: "report" },
      ],
      title: "分支流程",
    };
    const started = processWorkflowControl(createInitialWorkflowState(), {
      action: "start_workflow",
      workflow: branchingWorkflow,
    });
    const branch = processWorkflowControl(started.state, {
      action: "choose_branch",
      nodeId: "review",
      nextNodeId: "act",
      branchReason: "连续性未通过，需要返修。",
    });
    const looped = processWorkflowControl(branch.state, {
      action: "loop",
      nodeId: "act",
      nextNodeId: "act",
      reason: "返修后还需要再检查一轮。",
    });

    expect(branch.accepted).toBe(true);
    expect(branch.state.currentNodeId).toBe("act");
    expect(looped.accepted).toBe(true);
    expect(looped.state.nodes.find((node) => node.nodeId === "act")?.loopCount).toBe(1);
  });

  it("从 workflow_control 工具结果恢复状态", () => {
    const state = processWorkflowControl(createInitialWorkflowState(), {
      action: "start_workflow",
      workflow,
    }).state;
    const result = {
      accepted: true,
      kind: WORKFLOW_CONTROL_KIND,
      message: "ok",
      missing: [],
      state,
    };
    const part = {
      type: "tool-call" as const,
      toolName: WORKFLOW_CONTROL_TOOL_ID,
      toolCallId: "workflow-control-1",
      status: "completed" as const,
      inputSummary: "{}",
      output: result,
    };
    const messages: AgentMessage[] = [{
      author: "主代理",
      id: "assistant-1",
      role: "assistant",
      parts: [part],
    }];

    expect(deriveWorkflowState(messages).currentNodeId).toBe("inspect");
    expect(deriveWorkflowState([{
      ...messages[0],
      parts: [{
        ...part,
        output: {
          data: result,
          ok: true,
          summary: "工作流已启动。",
        },
      }],
    }]).currentNodeId).toBe("inspect");
  });
});
