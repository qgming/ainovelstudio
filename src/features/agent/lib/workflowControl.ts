import type { AgentMessage, AgentPart } from "./types";

export const WORKFLOW_CONTROL_TOOL_ID = "workflow_control";
export const WORKFLOW_CONTROL_KIND = "workflow-control";

export type WorkflowControlAction =
  | "draft_workflow"
  | "request_approval"
  | "start_workflow"
  | "complete_node"
  | "choose_branch"
  | "loop"
  | "blocked"
  | "complete_workflow";

export type WorkflowNodeType = "task" | "decision" | "loop" | "parallel" | "report";
export type WorkflowRunStatus = "empty" | "draft" | "pending_approval" | "running" | "blocked" | "completed";
export type WorkflowNodeRunStatus = "pending" | "running" | "completed" | "blocked" | "skipped";

export type WorkflowNodeDefinition = {
  gate: string;
  id: string;
  outputContract?: string;
  roleId: string;
  systemPrompt: string;
  title: string;
  tools?: string[];
  type: WorkflowNodeType;
};

export type WorkflowEdgeDefinition = {
  condition?: string;
  from: string;
  id: string;
  to: string;
};

export type WorkflowDefinition = {
  edges: WorkflowEdgeDefinition[];
  id: string;
  nodes: WorkflowNodeDefinition[];
  title: string;
};

export type WorkflowNodeState = {
  completedAt?: string;
  evidence: string[];
  loopCount: number;
  nodeId: string;
  startedAt?: string;
  status: WorkflowNodeRunStatus;
};

export type WorkflowHistoryRecord = {
  action: WorkflowControlAction;
  evidence: string[];
  nodeId?: string;
  reason?: string;
  timestamp: string;
};

export type WorkflowState = {
  currentNodeId?: string;
  definition?: WorkflowDefinition;
  history: WorkflowHistoryRecord[];
  nodes: WorkflowNodeState[];
  status: WorkflowRunStatus;
  workflowId?: string;
};

export type WorkflowControlResult = {
  accepted: boolean;
  currentNodeInstruction?: string;
  kind: typeof WORKFLOW_CONTROL_KIND;
  message: string;
  missing: string[];
  state: WorkflowState;
};

type ToolResultEnvelope = {
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeString(value: unknown, fallback = "") {
  return normalizeOptionalString(value) ?? fallback;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeAction(value: unknown): WorkflowControlAction {
  if (
    value === "draft_workflow"
    || value === "request_approval"
    || value === "start_workflow"
    || value === "complete_node"
    || value === "choose_branch"
    || value === "loop"
    || value === "blocked"
    || value === "complete_workflow"
  ) {
    return value;
  }
  throw new Error("workflow_control.action 不合法。");
}

function normalizeNodeType(value: unknown): WorkflowNodeType {
  if (value === "decision" || value === "loop" || value === "parallel" || value === "report") return value;
  return "task";
}

function normalizeTools(value: unknown) {
  const tools = normalizeStringArray(value);
  return tools.length > 0 ? tools : undefined;
}

function slugifyId(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeNode(value: unknown, index: number): WorkflowNodeDefinition | null {
  if (!isRecord(value)) return null;
  const title = normalizeString(value.title, `节点 ${index + 1}`);
  const id = slugifyId(normalizeString(value.id, title), `node-${index + 1}`);
  return {
    gate: normalizeString(value.gate, "提交可验证完成证据。"),
    id,
    outputContract: normalizeOptionalString(value.outputContract),
    roleId: normalizeString(value.roleId, "book"),
    systemPrompt: normalizeString(value.systemPrompt, `只执行“${title}”节点，满足节点门禁后提交证据。`),
    title,
    tools: normalizeTools(value.tools),
    type: normalizeNodeType(value.type),
  };
}

function normalizeEdge(value: unknown, index: number): WorkflowEdgeDefinition | null {
  if (!isRecord(value)) return null;
  const from = normalizeOptionalString(value.from);
  const to = normalizeOptionalString(value.to);
  if (!from || !to) return null;
  return {
    condition: normalizeOptionalString(value.condition),
    from,
    id: normalizeString(value.id, `edge-${index + 1}`),
    to,
  };
}

function normalizeWorkflowDefinition(value: unknown): WorkflowDefinition | null {
  if (!isRecord(value)) return null;
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.map(normalizeNode).filter((item): item is WorkflowNodeDefinition => item !== null)
    : [];
  if (nodes.length === 0) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(value.edges)
    ? value.edges
      .map(normalizeEdge)
      .filter((item): item is WorkflowEdgeDefinition => item !== null)
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    : [];
  const title = normalizeString(value.title, "工作流");
  return {
    edges,
    id: slugifyId(normalizeString(value.id, title), "workflow"),
    nodes,
    title,
  };
}

function buildNodeStates(definition: WorkflowDefinition, currentNodeId?: string, startCurrent = false): WorkflowNodeState[] {
  return definition.nodes.map((node) => ({
    evidence: [],
    loopCount: 0,
    nodeId: node.id,
    startedAt: startCurrent && node.id === (currentNodeId ?? definition.nodes[0]?.id) ? new Date().toISOString() : undefined,
    status: startCurrent && node.id === (currentNodeId ?? definition.nodes[0]?.id) ? "running" : "pending",
  }));
}

function cloneState(state: WorkflowState): WorkflowState {
  return {
    ...state,
    definition: state.definition
      ? {
        ...state.definition,
        edges: state.definition.edges.map((edge) => ({ ...edge })),
        nodes: state.definition.nodes.map((node) => ({ ...node, tools: node.tools ? [...node.tools] : undefined })),
      }
      : undefined,
    history: state.history.map((item) => ({ ...item, evidence: [...item.evidence] })),
    nodes: state.nodes.map((node) => ({ ...node, evidence: [...node.evidence] })),
  };
}

export function createInitialWorkflowState(): WorkflowState {
  return {
    history: [],
    nodes: [],
    status: "empty",
  };
}

export function getCurrentWorkflowNode(state: WorkflowState) {
  if (!state.definition || !state.currentNodeId) return null;
  return state.definition.nodes.find((node) => node.id === state.currentNodeId) ?? null;
}

export function formatCurrentWorkflowNodeInstruction(state: WorkflowState) {
  const node = getCurrentWorkflowNode(state);
  if (!node) return undefined;
  return [
    `# 当前工作流节点：${node.title}`,
    `- nodeId：${node.id}`,
    `- type：${node.type}`,
    `- roleId：${node.roleId}`,
    node.tools?.length ? `- 建议工具：${node.tools.join(", ")}` : null,
    `- 完成门禁：${node.gate}`,
    node.outputContract ? `- 输出契约：${node.outputContract}` : null,
    "",
    "## 节点补充系统提示词",
    node.systemPrompt,
  ].filter((line): line is string => line !== null).join("\n");
}

function accept(state: WorkflowState, message: string): WorkflowControlResult {
  return {
    accepted: true,
    currentNodeInstruction: formatCurrentWorkflowNodeInstruction(state),
    kind: WORKFLOW_CONTROL_KIND,
    message,
    missing: [],
    state,
  };
}

function reject(state: WorkflowState, message: string, missing: string[]): WorkflowControlResult {
  const clonedState = cloneState(state);
  return {
    accepted: false,
    currentNodeInstruction: formatCurrentWorkflowNodeInstruction(clonedState),
    kind: WORKFLOW_CONTROL_KIND,
    message,
    missing,
    state: clonedState,
  };
}

function appendHistory(
  state: WorkflowState,
  action: WorkflowControlAction,
  input: Record<string, unknown>,
  evidence = normalizeStringArray(input.evidence),
) {
  state.history = [
    ...state.history,
    {
      action,
      evidence,
      nodeId: normalizeOptionalString(input.nodeId),
      reason: normalizeOptionalString(input.reason) ?? normalizeOptionalString(input.branchReason),
      timestamp: new Date().toISOString(),
    },
  ];
}

function getDefinitionFromInput(input: Record<string, unknown>) {
  return normalizeWorkflowDefinition(input.workflow ?? input.definition);
}

function requireDefinition(state: WorkflowState) {
  return state.definition ?? null;
}

function setNodeStatus(
  state: WorkflowState,
  nodeId: string,
  status: WorkflowNodeRunStatus,
  evidence?: string[],
) {
  const now = new Date().toISOString();
  state.nodes = state.nodes.map((node) => {
    if (node.nodeId !== nodeId) return node;
    return {
      ...node,
      completedAt: status === "completed" ? now : node.completedAt,
      evidence: evidence ?? node.evidence,
      startedAt: node.startedAt ?? now,
      status,
    };
  });
}

function getFirstNodeId(definition: WorkflowDefinition) {
  return definition.nodes[0]?.id;
}

function getNextNodeId(definition: WorkflowDefinition, nodeId: string, preferred?: string) {
  if (preferred && definition.nodes.some((node) => node.id === preferred)) return preferred;
  return definition.edges.find((edge) => edge.from === nodeId)?.to;
}

function startNode(state: WorkflowState, nodeId: string) {
  state.currentNodeId = nodeId;
  setNodeStatus(state, nodeId, "running");
}

function draftWorkflow(state: WorkflowState, input: Record<string, unknown>) {
  const definition = getDefinitionFromInput(input);
  if (!definition) return reject(state, "工作流草案未通过校验。", ["workflow.nodes 至少需要 1 个有效节点。"]);
  const nextState: WorkflowState = {
    currentNodeId: getFirstNodeId(definition),
    definition,
    history: [...state.history],
    nodes: buildNodeStates(definition),
    status: "draft",
    workflowId: definition.id,
  };
  appendHistory(nextState, "draft_workflow", input, []);
  return accept(nextState, `已生成工作流草案：${definition.title}`);
}

function requestApproval(state: WorkflowState, input: Record<string, unknown>) {
  const definition = getDefinitionFromInput(input) ?? state.definition;
  if (!definition) return reject(state, "没有可确认的工作流草案。", ["先调用 draft_workflow 提交 workflow。"]);
  const nextState: WorkflowState = {
    currentNodeId: getFirstNodeId(definition),
    definition,
    history: [...state.history],
    nodes: state.definition?.id === definition.id && state.nodes.length > 0 ? state.nodes : buildNodeStates(definition),
    status: "pending_approval",
    workflowId: definition.id,
  };
  appendHistory(nextState, "request_approval", input, []);
  return accept(nextState, `工作流等待用户确认：${definition.title}`);
}

function startWorkflow(state: WorkflowState, input: Record<string, unknown>) {
  const definition = getDefinitionFromInput(input) ?? state.definition;
  if (!definition) return reject(state, "没有可启动的工作流。", ["先生成并确认 workflow。"]);
  const firstNodeId = normalizeOptionalString(input.nodeId) ?? getFirstNodeId(definition);
  if (!firstNodeId) return reject(state, "工作流缺少起始节点。", ["workflow.nodes 至少需要 1 个节点。"]);
  const nextState: WorkflowState = {
    currentNodeId: firstNodeId,
    definition,
    history: [...state.history],
    nodes: buildNodeStates(definition, firstNodeId, true),
    status: "running",
    workflowId: definition.id,
  };
  startNode(nextState, firstNodeId);
  appendHistory(nextState, "start_workflow", input, []);
  return accept(nextState, `工作流已启动，当前节点：${firstNodeId}`);
}

function completeNode(state: WorkflowState, input: Record<string, unknown>) {
  const definition = requireDefinition(state);
  if (!definition) return reject(state, "没有运行中的工作流。", ["先启动工作流。"]);
  const nodeId = normalizeOptionalString(input.nodeId) ?? state.currentNodeId;
  const evidence = normalizeStringArray(input.evidence);
  if (!nodeId) return reject(state, "缺少 nodeId。", ["complete_node.nodeId 不能为空。"]);
  if (state.status !== "running") return reject(state, "工作流不在运行中。", ["只有 running 状态可以完成节点。"]);
  if (nodeId !== state.currentNodeId) return reject(state, "节点推进未通过门禁。", [`当前节点是 ${state.currentNodeId}，不能提交 ${nodeId}。`]);
  if (evidence.length === 0) return reject(state, "节点完成未通过门禁。", ["complete_node.evidence 至少需要 1 条证据。"]);

  const nextState = cloneState(state);
  setNodeStatus(nextState, nodeId, "completed", evidence);
  const nextNodeId = getNextNodeId(definition, nodeId, normalizeOptionalString(input.nextNodeId));
  if (nextNodeId) {
    startNode(nextState, nextNodeId);
  } else {
    nextState.currentNodeId = undefined;
    nextState.status = "completed";
  }
  appendHistory(nextState, "complete_node", input, evidence);
  return accept(nextState, nextNodeId ? `节点已完成，进入 ${nextNodeId}。` : "所有节点已完成。");
}

function chooseBranch(state: WorkflowState, input: Record<string, unknown>) {
  const definition = requireDefinition(state);
  if (!definition) return reject(state, "没有运行中的工作流。", ["先启动工作流。"]);
  const nodeId = normalizeOptionalString(input.nodeId) ?? state.currentNodeId;
  const nextNodeId = normalizeOptionalString(input.nextNodeId);
  const reason = normalizeOptionalString(input.branchReason) ?? normalizeOptionalString(input.reason);
  if (!nodeId || !nextNodeId) return reject(state, "分支选择缺少节点。", ["choose_branch.nodeId 和 nextNodeId 不能为空。"]);
  if (!reason) return reject(state, "分支选择缺少理由。", ["choose_branch.branchReason 不能为空。"]);
  const allowed = definition.edges.some((edge) => edge.from === nodeId && edge.to === nextNodeId);
  if (!allowed) return reject(state, "分支不在工作流连线上。", [`${nodeId} -> ${nextNodeId} 不是有效边。`]);

  const nextState = cloneState(state);
  setNodeStatus(nextState, nodeId, "completed", [reason]);
  startNode(nextState, nextNodeId);
  nextState.status = "running";
  appendHistory(nextState, "choose_branch", input, [reason]);
  return accept(nextState, `已选择分支：${nodeId} -> ${nextNodeId}`);
}

function loopWorkflow(state: WorkflowState, input: Record<string, unknown>) {
  const definition = requireDefinition(state);
  if (!definition) return reject(state, "没有运行中的工作流。", ["先启动工作流。"]);
  const nodeId = normalizeOptionalString(input.nodeId) ?? state.currentNodeId;
  const nextNodeId = normalizeOptionalString(input.nextNodeId) ?? nodeId;
  const reason = normalizeOptionalString(input.reason);
  if (!nodeId || !nextNodeId) return reject(state, "循环缺少节点。", ["loop.nodeId 和 nextNodeId 不能为空。"]);
  if (!reason) return reject(state, "循环缺少理由。", ["loop.reason 必须说明继续循环或退出条件。"]);
  if (!definition.nodes.some((node) => node.id === nextNodeId)) return reject(state, "循环目标节点不存在。", [`未知节点：${nextNodeId}`]);

  const nextState = cloneState(state);
  nextState.nodes = nextState.nodes.map((node) => node.nodeId === nodeId ? { ...node, loopCount: node.loopCount + 1 } : node);
  startNode(nextState, nextNodeId);
  nextState.status = "running";
  appendHistory(nextState, "loop", input, [reason]);
  return accept(nextState, `工作流循环到 ${nextNodeId}。`);
}

function blockWorkflow(state: WorkflowState, input: Record<string, unknown>) {
  const reason = normalizeOptionalString(input.reason);
  if (!reason) return reject(state, "阻塞信号未通过门禁。", ["blocked.reason 不能为空。"]);
  const nextState = cloneState(state);
  nextState.status = "blocked";
  if (nextState.currentNodeId) setNodeStatus(nextState, nextState.currentNodeId, "blocked");
  appendHistory(nextState, "blocked", input, []);
  return accept(nextState, `工作流已阻塞：${reason}`);
}

function completeWorkflow(state: WorkflowState, input: Record<string, unknown>) {
  const evidence = normalizeStringArray(input.evidence);
  if (evidence.length === 0) return reject(state, "工作流完成未通过门禁。", ["complete_workflow.evidence 至少需要 1 条证据。"]);
  const nextState = cloneState(state);
  nextState.status = "completed";
  nextState.currentNodeId = undefined;
  appendHistory(nextState, "complete_workflow", input, evidence);
  return accept(nextState, "工作流已完成。");
}

export function processWorkflowControl(state: WorkflowState, input: Record<string, unknown>): WorkflowControlResult {
  const action = normalizeAction(input.action);
  if (action === "draft_workflow") return draftWorkflow(state, input);
  if (action === "request_approval") return requestApproval(state, input);
  if (action === "start_workflow") return startWorkflow(state, input);
  if (action === "complete_node") return completeNode(state, input);
  if (action === "choose_branch") return chooseBranch(state, input);
  if (action === "loop") return loopWorkflow(state, input);
  if (action === "blocked") return blockWorkflow(state, input);
  return completeWorkflow(state, input);
}

export function createWorkflowController(initialState?: WorkflowState) {
  let state = cloneState(initialState ?? createInitialWorkflowState());
  return {
    getState: () => cloneState(state),
    process: (input: Record<string, unknown>) => {
      const result = processWorkflowControl(state, input);
      state = result.state;
      return result;
    },
  };
}

export function isWorkflowControlResult(value: unknown): value is WorkflowControlResult {
  if (!isRecord(value)) return false;
  return value.kind === WORKFLOW_CONTROL_KIND
    && typeof value.accepted === "boolean"
    && isRecord(value.state);
}

export function extractWorkflowControlResult(output: unknown): WorkflowControlResult | null {
  if (isWorkflowControlResult(output)) return output;
  if (!isRecord(output)) return null;
  const envelope = output as ToolResultEnvelope;
  return isWorkflowControlResult(envelope.data) ? envelope.data : null;
}

export function getWorkflowControlFromPart(part: AgentPart) {
  if ((part.type !== "tool-call" && part.type !== "tool-result") || part.toolName !== WORKFLOW_CONTROL_TOOL_ID) {
    return null;
  }
  return extractWorkflowControlResult(part.output);
}

export function deriveWorkflowState(messages: AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const result = getWorkflowControlFromPart(part);
      if (result) return cloneState(result.state);
    }
  }
  return createInitialWorkflowState();
}

export function formatWorkflowState(state: WorkflowState) {
  if (!state.definition) {
    return [
      "- status：empty",
      "- 当前没有工作流。先与用户澄清目标，再用 workflow_control.draft_workflow 提交流程草案。",
    ].join("\n");
  }

  const currentNode = state.definition.nodes.find((node) => node.id === state.currentNodeId);
  const nodeLines = state.definition.nodes.map((node, index) => {
    const runtime = state.nodes.find((item) => item.nodeId === node.id);
    const marker = runtime?.status === "completed"
      ? "[x]"
      : runtime?.status === "running"
        ? "[>]"
        : runtime?.status === "blocked"
          ? "[!]"
          : "[ ]";
    return [
      `${index + 1}. ${marker} ${node.title}（${node.type} / ${node.roleId}）门禁：${node.gate}`,
      runtime?.status === "running" ? `   节点提示：${node.systemPrompt}` : null,
      runtime?.status === "running" && node.outputContract ? `   输出契约：${node.outputContract}` : null,
    ].filter(Boolean).join("\n");
  });

  return [
    `- workflowId：${state.workflowId ?? state.definition.id}`,
    `- title：${state.definition.title}`,
    `- status：${state.status}`,
    `- currentNode：${currentNode ? `${currentNode.title}（${currentNode.id}）` : "无"}`,
    "- nodes：",
    ...nodeLines,
  ].join("\n");
}
