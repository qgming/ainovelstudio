import type { AgentMessage } from "./types";
import {
  MODE_CONTROL_TOOL_ID,
  isModeControlData,
} from "./modeControl";

export const FLOW_WORKFLOW_ID = "chapter-harness";

export const FLOW_WORKFLOW_STAGES = [
  { id: "inspect", label: "Inspect", gate: "读取项目上下文、status、相关设定/大纲/正文或其他事实源。" },
  { id: "skill_load", label: "Skill Load", gate: "任务命中 skill 时已读取对应 SKILL.md。" },
  { id: "plan", label: "Plan", gate: "需要多步推进时已写入 todo 计划。" },
  { id: "act", label: "Act", gate: "已完成本阶段写入、编辑、查询或分析动作。" },
  { id: "verify", label: "Verify", gate: "已用 read、word_count、json 或查询工具核对结果。" },
  { id: "state_maintain", label: "State Maintain", gate: "已维护 status 或按任务需要补充的项目文件。" },
  { id: "report", label: "Report", gate: "已形成最终交付说明、风险和下一步。" },
] as const;

export type FlowWorkflowStageId = typeof FLOW_WORKFLOW_STAGES[number]["id"];
export type FlowWorkflowStatus = "running" | "blocked" | "completed";
export type FlowWorkflowAction = "complete_stage" | "blocked" | "complete_workflow";

export type FlowWorkflowStageRecord = {
  action: FlowWorkflowAction;
  evidence: string[];
  reason?: string;
  stage: FlowWorkflowStageId;
  timestamp: string;
};

export type FlowWorkflowState = {
  workflowId: typeof FLOW_WORKFLOW_ID;
  currentStage: FlowWorkflowStageId;
  status: FlowWorkflowStatus;
  completedStages: FlowWorkflowStageId[];
  history: FlowWorkflowStageRecord[];
};

export type FlowWorkflowControlResult = {
  accepted: boolean;
  message: string;
  missing: string[];
  state: FlowWorkflowState;
};

export function createInitialFlowWorkflowState(): FlowWorkflowState {
  return {
    workflowId: FLOW_WORKFLOW_ID,
    currentStage: "inspect",
    status: "running",
    completedStages: [],
    history: [],
  };
}

export function formatFlowWorkflowState(state: FlowWorkflowState) {
  const current = getStage(state.currentStage);
  return [
    `- workflowId：${state.workflowId}`,
    `- status：${state.status}`,
    `- currentStage：${current.label}（${current.id}）`,
    `- completedStages：${state.completedStages.length ? state.completedStages.join(" -> ") : "无"}`,
    `- 当前阶段门禁：${current.gate}`,
  ].join("\n");
}

export function createFlowWorkflowController(initialState?: FlowWorkflowState) {
  let state = cloneState(initialState ?? createInitialFlowWorkflowState());
  return {
    getState: () => cloneState(state),
    process: (input: Record<string, unknown>) => {
      const result = processFlowWorkflowControl(state, input);
      state = result.state;
      return result;
    },
  };
}

export function deriveFlowWorkflowState(messages: AgentMessage[]) {
  const latest = findLatestWorkflowState(messages);
  return latest ? cloneState(latest) : createInitialFlowWorkflowState();
}

export function processFlowWorkflowControl(
  state: FlowWorkflowState,
  input: Record<string, unknown>,
): FlowWorkflowControlResult {
  const workflowIdError = validateWorkflowId(input.workflowId);
  if (workflowIdError) return reject(state, "工作流 ID 未通过程序门禁。", [workflowIdError]);
  const action = normalizeAction(input.action);
  if (action === "blocked") return blockWorkflow(state, input);
  if (action === "complete_workflow") return completeWorkflow(state, input);
  return completeStage(state, input);
}

function completeStage(state: FlowWorkflowState, input: Record<string, unknown>) {
  const stage = normalizeStage(input.stage) ?? state.currentStage;
  const evidence = normalizeStringArray(input.evidence);
  const missing = validateStageCompletion(state, stage, evidence);
  if (missing.length > 0) return reject(state, "阶段推进未通过程序门禁。", missing);

  const nextState = cloneState(state);
  nextState.status = "running";
  nextState.completedStages = addCompletedStage(nextState.completedStages, stage);
  nextState.currentStage = getNextStage(stage) ?? stage;
  nextState.history = [...nextState.history, buildRecord("complete_stage", stage, evidence, input.reason)];
  return accept(nextState, `已完成 ${getStage(stage).label}，进入 ${getStage(nextState.currentStage).label}。`);
}

function completeWorkflow(state: FlowWorkflowState, input: Record<string, unknown>) {
  const evidence = normalizeStringArray(input.evidence);
  const missing = FLOW_WORKFLOW_STAGES
    .filter((stage) => !state.completedStages.includes(stage.id))
    .map((stage) => `缺少阶段完成记录：${stage.label}`);
  if (evidence.length === 0) missing.push("complete_workflow.evidence 至少需要 1 条验收证据。");
  if (missing.length > 0) return reject(state, "工作流完成未通过程序门禁。", missing);

  const nextState = cloneState(state);
  nextState.status = "completed";
  nextState.history = [...nextState.history, buildRecord("complete_workflow", state.currentStage, evidence, input.reason)];
  return accept(nextState, "工作流已完成。");
}

function blockWorkflow(state: FlowWorkflowState, input: Record<string, unknown>) {
  const stage = normalizeStage(input.stage) ?? state.currentStage;
  const reason = normalizeOptionalString(input.reason);
  if (!reason) return reject(state, "阻塞信号未通过程序门禁。", ["blocked.reason 不能为空。"]);

  const nextState = cloneState(state);
  nextState.status = "blocked";
  nextState.currentStage = stage;
  nextState.history = [...nextState.history, buildRecord("blocked", stage, [], reason)];
  return accept(nextState, `工作流阻塞在 ${getStage(stage).label}：${reason}`);
}

function validateStageCompletion(state: FlowWorkflowState, stage: FlowWorkflowStageId, evidence: string[]) {
  const missing: string[] = [];
  if (state.status === "completed") missing.push("工作流已经完成。");
  if (stage !== state.currentStage) missing.push(`当前阶段是 ${state.currentStage}，不能提交 ${stage}。`);
  if (evidence.length === 0) missing.push("complete_stage.evidence 至少需要 1 条证据。");
  return missing;
}

function findLatestWorkflowState(messages: AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if ((part.type !== "tool-call" && part.type !== "tool-result") || part.toolName !== MODE_CONTROL_TOOL_ID) continue;
      const output = part.output;
      if (!isModeControlData(output) || output.mode !== "flow") continue;
      const workflowState = getWorkflowState(output.workflow);
      if (workflowState) return workflowState;
    }
  }
  return null;
}

function accept(state: FlowWorkflowState, message: string): FlowWorkflowControlResult {
  return { accepted: true, message, missing: [], state };
}

function reject(state: FlowWorkflowState, message: string, missing: string[]): FlowWorkflowControlResult {
  return { accepted: false, message, missing, state: cloneState(state) };
}

function buildRecord(
  action: FlowWorkflowAction,
  stage: FlowWorkflowStageId,
  evidence: string[],
  reason: unknown,
): FlowWorkflowStageRecord {
  return { action, evidence, reason: normalizeOptionalString(reason), stage, timestamp: new Date().toISOString() };
}

function addCompletedStage(stages: FlowWorkflowStageId[], stage: FlowWorkflowStageId) {
  return stages.includes(stage) ? stages : [...stages, stage];
}

function getNextStage(stage: FlowWorkflowStageId) {
  const index = FLOW_WORKFLOW_STAGES.findIndex((item) => item.id === stage);
  return FLOW_WORKFLOW_STAGES[index + 1]?.id;
}

function getStage(stage: FlowWorkflowStageId) {
  return FLOW_WORKFLOW_STAGES.find((item) => item.id === stage) ?? FLOW_WORKFLOW_STAGES[0];
}

function normalizeAction(value: unknown): FlowWorkflowAction {
  if (value === "complete_stage" || value === "blocked" || value === "complete_workflow") return value;
  throw new Error("flow mode_control.action 必须是 complete_stage、blocked 或 complete_workflow。");
}

function validateWorkflowId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return value === FLOW_WORKFLOW_ID ? null : `当前只支持 workflowId=${FLOW_WORKFLOW_ID}。`;
}

function normalizeStage(value: unknown): FlowWorkflowStageId | undefined {
  return FLOW_WORKFLOW_STAGES.find((stage) => stage.id === value)?.id;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeOptionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function cloneState(state: FlowWorkflowState): FlowWorkflowState {
  return {
    ...state,
    completedStages: [...state.completedStages],
    history: state.history.map((item) => ({ ...item, evidence: [...item.evidence] })),
  };
}

function isFlowWorkflowState(value: unknown): value is FlowWorkflowState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FlowWorkflowState>;
  return candidate.workflowId === FLOW_WORKFLOW_ID
    && Boolean(normalizeStage(candidate.currentStage))
    && Array.isArray(candidate.completedStages)
    && Array.isArray(candidate.history);
}

function getWorkflowState(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const state = (value as { state?: unknown }).state;
  return isFlowWorkflowState(state) ? state : null;
}
