/**
 * useExpansionWorkspaceAgent：扩写工作区中"运行 AI 动作"的运行态封装。
 *
 * 之前 ExpansionDetailPage 顶部 ~150 行的 runWorkspaceAgentAction 内联实现。
 * 抽出后页面组件只关心调用接口与回调结果显示。
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { runAgentTurn } from "../../lib/agent/session";
import { buildExpansionTools } from "../../lib/agent/toolsets/factory";
import type { AgentPart, AgentRunStatus, AgentUsage } from "../../lib/agent/types";
import { mergePart } from "../../lib/chat/sessionRuntime";
import { readExpansionEntry } from "../../lib/expansion/api";
import type {
  ExpansionWorkspaceActionId,
  ExpansionWorkspaceTask,
} from "../../components/expansion/detail/ExpansionWorkspacePanel";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { getEnabledAgents, useSubAgentStore } from "../../stores/subAgentStore";

/** 扩写模式默认启用的工具集（全工具开放给 AI）。 */
const EXPANSION_ENABLED_TOOL_IDS = [
  "todo",
  "task",
  "browse",
  "search",
  "read",
  "write",
  "path",
  "skill",
  "agent",
  "web_search",
  "web_fetch",
  "expansion_chapter_batch_outline",
  "expansion_chapter_write_content",
  "expansion_setting_batch_generate",
  "expansion_setting_update_from_chapter",
  "expansion_continuity_scan",
];

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export type RunExpansionAgentActionParams = {
  actionId: ExpansionWorkspaceActionId;
  actionLabel: string;
  description: string;
  prompt: string;
  targetLabel: string;
};

export type UseExpansionWorkspaceAgentOptions = {
  workspaceId: string | undefined;
  /** 创作台工作区名称，用于 usage 日志中的来源书名展示。 */
  workspaceName?: string | null;
  /** 当前编辑文件路径（如 settings/...）。 */
  currentFilePath: string | null;
  /** 上下文项目文件列表，用于注入 projectContext。 */
  projectEntries: Array<{ path: string }>;
  /** AI 调用结束后刷新页面数据的回调。 */
  onWorkspaceMutated: () => Promise<void>;
  /** 出错时弹 toast。 */
  onError: (message: string) => void;
};

export function useExpansionWorkspaceAgent({
  workspaceId,
  workspaceName,
  currentFilePath,
  projectEntries,
  onWorkspaceMutated,
  onError,
}: UseExpansionWorkspaceAgentOptions) {
  const [activeTask, setActiveTask] = useState<ExpansionWorkspaceTask | null>(null);
  const [agentParts, setAgentParts] = useState<AgentPart[]>([]);
  const [executionPrompt, setExecutionPrompt] = useState("");
  const [runStatus, setRunStatus] = useState<AgentRunStatus>("idle");
  const [stopRequested, setStopRequested] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** 重置任务上下文，例如切换 workspace 时调用。 */
  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setActiveTask(null);
    setAgentParts([]);
    setExecutionPrompt("");
    setRunStatus("idle");
    setStopRequested(false);
  }, []);

  const stopAction = useCallback(() => {
    const abortController = abortControllerRef.current;
    if (!abortController || abortController.signal.aborted) {
      return;
    }

    setStopRequested(true);
    abortController.abort();
  }, []);

  /** 触发一次工作区 AI 动作，流式合并 part 到 agentParts。 */
  const runAction = useCallback(
    async (params: RunExpansionAgentActionParams) => {
      if (!workspaceId) return;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setActiveTask({
        actionId: params.actionId,
        actionLabel: params.actionLabel,
        createdAt: Date.now(),
        description: params.description,
        statusLabel: "运行中",
        targetLabel: params.targetLabel,
      });
      setAgentParts([]);
      setExecutionPrompt(params.prompt);
      setRunStatus("running");
      setStopRequested(false);

      try {
        // 准备依赖 store。
        const agentSettings = useAgentSettingsStore.getState();
        if (agentSettings.status !== "ready") await agentSettings.initialize();
        const skillsStore = useSkillsStore.getState();
        if (skillsStore.status === "idle") await skillsStore.initialize();
        const subAgents = useSubAgentStore.getState();
        if (subAgents.status === "idle") await subAgents.initialize();

        const providerConfig = useAgentSettingsStore.getState().config;
        const defaultAgentMarkdown = useAgentSettingsStore.getState().defaultAgentMarkdown;
        const enabledSkills = getEnabledSkills(useSkillsStore.getState());
        const enabledAgents = getEnabledAgents(useSubAgentStore.getState());

        // 把当前 workspace 的项目文件作为 projectContext 一次性读出来。
        const projectFiles = await Promise.all(
          projectEntries.map(async (entry) => ({
            content: await readExpansionEntry(workspaceId, "project", entry.path),
            name: entry.path,
            path: `project/${entry.path}`,
          })),
        );

        const persistUsage = async (usage: AgentUsage) => {
          await invoke("record_expansion_usage", {
            payload: {
              workspaceId,
              workspaceName: workspaceName ?? "",
              actionId: params.actionId,
              actionLabel: params.actionLabel,
              usage: {
                recordedAt: String(Math.floor(Date.now() / 1000)),
                provider: usage.provider,
                modelId: usage.modelId,
                finishReason: usage.finishReason,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                noCacheTokens: usage.noCacheTokens,
                cacheReadTokens: usage.cacheReadTokens,
                cacheWriteTokens: usage.cacheWriteTokens,
                reasoningTokens: usage.reasoningTokens,
              },
            },
          });
        };

        const executePrompt = async (prompt: string, initialParts: AgentPart[] = []) => {
          const stream = runAgentTurn({
            activeFilePath: currentFilePath,
            abortSignal: abortController.signal,
            conversationHistory: [],
            defaultAgentMarkdown,
            enabledAgents,
            enabledSkills,
            enabledToolIds: EXPANSION_ENABLED_TOOL_IDS,
            mode: "expansion",
            modeContext: {
              actionId: params.actionId,
              actionLabel: params.actionLabel,
            },
            manualContext: null,
            planningState: { items: [], roundsSinceUpdate: 0 },
            projectContext: {
              source: "创作台默认上下文",
              files: projectFiles,
            },
            prompt,
            providerConfig,
            onUsage: (usage) => {
              void persistUsage(usage);
            },
            workspaceRootPath: `expansion://${workspaceId}`,
            workspaceTools: buildExpansionTools({
              workspaceId,
              onWorkspaceMutated,
            }),
          });

          let nextParts = initialParts;
          for await (const part of stream) {
            nextParts = mergePart(nextParts, part as AgentPart);
            setAgentParts(nextParts);
          }
          return nextParts;
        };

        await executePrompt(params.prompt);

        setRunStatus("completed");
        setActiveTask((current) => (current ? { ...current, statusLabel: "已完成" } : current));
        await onWorkspaceMutated();
      } catch (error) {
        if (isAbortError(error)) {
          setRunStatus("idle");
          setAgentParts((current) =>
            current.some(
              (part) => part.type === "text" && part.text === "已终止当前运行。",
            )
              ? current
              : [...current, { type: "text", text: "已终止当前运行。" }],
          );
          setActiveTask((current) => (current ? { ...current, statusLabel: "已终止" } : current));
          return;
        }

        const message = error instanceof Error ? error.message : "创作台 Agent 执行失败。";
        setRunStatus("failed");
        setAgentParts((current) => [...current, { type: "text", text: message }]);
        setActiveTask((current) => (current ? { ...current, statusLabel: "失败" } : current));
        onError(message);
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setStopRequested(false);
      }
    },
    [workspaceId, currentFilePath, projectEntries, onWorkspaceMutated, onError],
  );

  return {
    activeTask,
    agentParts,
    executionPrompt,
    runStatus,
    runAction,
    reset,
    stopAction,
    stopRequested,
  };
}
