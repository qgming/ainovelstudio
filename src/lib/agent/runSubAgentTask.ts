/**
 * 子代理任务执行：在干净上下文中委托一个子 agent 完成局部任务，并以 onProgress 报告进度。
 *
 * 之前定义在 session.ts 顶部，现拆分以便主回合主流程更清晰可读。
 */

import type { ResolvedAgent } from "../../stores/subAgentStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import { selectSubAgentForPrompt } from "./delegation";
import { streamAgentText } from "./modelGateway";
import { buildSubAgentSystem } from "./promptContext";
import { buildAiSdkTools } from "./buildAiSdkTools";
import { createSubagentSnapshot, mergeSubagentInnerParts } from "./subagentParts";
import { throwIfAborted } from "./asyncUtils";
import { createToolResultPart } from "./toolParts";
import type { AgentTool } from "./runtime";
import type { AgentPart } from "./types";

export type RunSubAgentTaskParams = {
  abortSignal?: AbortSignal;
  agentId?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  taskPrompt: string;
  providerConfig: AgentProviderConfig;
  streamFn: typeof streamAgentText;
  workspaceTools: Record<string, AgentTool>;
  enabledToolIds: string[];
  onProgress?: (snapshot: AgentPart & { type: "subagent" }) => void;
};

export async function runSubAgentTask(
  params: RunSubAgentTaskParams,
): Promise<{ agent: ResolvedAgent; text: string; subagentId: string }> {
  const {
    abortSignal,
    agentId,
    enabledAgents,
    enabledSkills,
    taskPrompt,
    providerConfig,
    streamFn,
    workspaceTools,
    enabledToolIds,
    onProgress,
  } = params;

  // 1. 选择子代理：显式 ID 优先；否则单 agent 直选；多 agent 走启发式匹配。
  const explicitAgent = agentId
    ? (enabledAgents.find((agent) => agent.id === agentId) ?? null)
    : null;
  if (agentId && !explicitAgent) {
    throw new Error(`未找到可用子代理：${agentId}`);
  }
  const matchedAgent =
    explicitAgent ??
    (enabledAgents.length === 1
      ? enabledAgents[0]
      : selectSubAgentForPrompt(taskPrompt, enabledAgents));
  if (!matchedAgent) {
    throw new Error("无法确定子代理，请在 task.agentId 中指定目标代理 ID。");
  }

  const subagentPrompt = [
    "这是父代理拆出的一个局部子任务，请在干净上下文中完成，并只返回必要摘要或结果。",
    "## 子任务请求",
    taskPrompt,
  ].join("\n\n");

  const subagentId = `subagent-${matchedAgent.id}-${Date.now()}`;
  const innerParts: AgentPart[] = [];
  const subagentTools = buildAiSdkTools(
    workspaceTools,
    enabledToolIds,
    abortSignal,
    undefined,
  );

  throwIfAborted(abortSignal);
  onProgress?.(
    createSubagentSnapshot({
      id: subagentId,
      name: matchedAgent.name,
      status: "running",
      summary: `已派发子任务：${matchedAgent.name}`,
      parts: innerParts,
    }),
  );

  // 2. 调用 LLM 并流式收集片段。
  const result = streamFn({
    abortSignal,
    messages: [{ role: "user", content: subagentPrompt }],
    providerConfig,
    system: buildSubAgentSystem(matchedAgent, enabledSkills),
    tools: Object.keys(subagentTools).length > 0 ? subagentTools : undefined,
  });

  for await (const part of result.fullStream) {
    throwIfAborted(abortSignal);
    let mappedPart: AgentPart | null = null;

    switch (part.type) {
      case "text-delta":
        mappedPart = { type: "text-delta", delta: part.text };
        break;
      case "reasoning-delta":
        mappedPart = {
          type: "reasoning",
          summary: "正在思考",
          detail: part.text,
        };
        break;
      case "tool-call":
        mappedPart = {
          type: "tool-call",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          status: "running",
          inputSummary: JSON.stringify(part.input),
        };
        break;
      case "tool-result":
        mappedPart = createToolResultPart({
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          output: part.output,
        });
        break;
      default:
        break;
    }

    if (!mappedPart) {
      continue;
    }

    const mergedParts = mergeSubagentInnerParts(innerParts, mappedPart);
    innerParts.splice(0, innerParts.length, ...mergedParts);
    throwIfAborted(abortSignal);
    onProgress?.(
      createSubagentSnapshot({
        id: subagentId,
        name: matchedAgent.name,
        status: "running",
        summary: `${matchedAgent.name} 子任务执行中`,
        parts: innerParts,
      }),
    );
  }

  // 3. 汇总文本片段作为子任务的最终摘要。
  const finalText = innerParts
    .filter(
      (part): part is Extract<AgentPart, { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");

  throwIfAborted(abortSignal);
  onProgress?.(
    createSubagentSnapshot({
      id: subagentId,
      name: matchedAgent.name,
      status: "completed",
      summary: `${matchedAgent.name} 子任务已完成`,
      detail: finalText,
      parts: innerParts,
    }),
  );

  return { agent: matchedAgent, text: finalText, subagentId };
}
