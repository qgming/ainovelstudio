import { create } from "zustand";
import { getStoredAgentConfig, getStoredEnabledTools, useAgentSettingsStore } from "./agentSettingsStore";
import { runAgentTurn } from "../lib/agent/session";
import { createWorkspaceToolset } from "../lib/agent/tools";
import type { AgentMessage, AgentPart, AgentRun } from "../lib/agent/types";
import { useBookWorkspaceStore } from "./bookWorkspaceStore";
import { getEnabledSkills, useSkillsStore } from "./skillsStore";
import { getEnabledAgents, useSubAgentStore } from "./subAgentStore";

type AgentStoreState = {
  abortController: AbortController | null;
  contextTags: string[];
  input: string;
  run: AgentRun;
};

type AgentStoreActions = {
  reset: () => void;
  sendMessage: () => Promise<void>;
  stopMessage: () => void;
  setInput: (value: string) => void;
};

export type AgentStore = AgentStoreState & AgentStoreActions;

function buildInitialRun(): AgentRun {
  return {
    id: "run-default",
    status: "idle",
    title: "",
    messages: [],
  };
}

function buildInitialState(): AgentStoreState {
  return {
    abortController: null,
    contextTags: ["工具: 文件工作区"],
    input: "",
    run: buildInitialRun(),
  };
}

function buildUserMessage(text: string): AgentMessage {
  return {
    id: `user-${Date.now()}`,
    role: "user",
    author: "你",
    parts: [{ type: "text", text }],
  };
}

function buildAssistantPlaceholderMessage(): AgentMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: "assistant",
    author: "主代理",
    parts: [{ type: "placeholder", text: "思考中..." }],
  };
}

/** 将流式 part 合并到 assistant message 的 parts 数组 */
function mergePart(parts: AgentPart[], part: AgentPart): AgentPart[] {
  const nextParts = parts[0]?.type === "placeholder" ? [] : parts;

  if (part.type === "text-delta") {
    const last = nextParts[nextParts.length - 1];
    if (last && last.type === "text") {
      // 追加到已有 text part
      return [...nextParts.slice(0, -1), { ...last, text: last.text + part.delta }];
    }
    // 新建 text part
    return [...nextParts, { type: "text", text: part.delta }];
  }

  if (part.type === "reasoning") {
    const last = nextParts[nextParts.length - 1];
    if (last && last.type === "reasoning") {
      // 追加到已有 reasoning part 的 detail
      return [...nextParts.slice(0, -1), { ...last, detail: last.detail + part.detail }];
    }
    return [...nextParts, part];
  }

  if (part.type === "subagent") {
    const existingIndex = nextParts.findIndex(
      (candidate) => candidate.type === "subagent" && candidate.id === part.id,
    );
    if (existingIndex >= 0) {
      return nextParts.map((candidate, index) => (index === existingIndex ? { ...candidate, ...part } : candidate));
    }
    return [...nextParts, part];
  }

  if (part.type === "tool-result") {
    for (let index = nextParts.length - 1; index >= 0; index -= 1) {
      const candidate = nextParts[index];
      if (candidate?.type === "tool-call" && candidate.toolName === part.toolName && candidate.status === "running") {
        return [
          ...nextParts.slice(0, index),
          {
            ...candidate,
            status: part.status,
            outputSummary: part.outputSummary,
          },
          ...nextParts.slice(index + 1),
        ];
      }
    }
  }

  return [...nextParts, part];
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...buildInitialState(),
  reset: () => {
    get().abortController?.abort();
    set(buildInitialState());
  },
  sendMessage: async () => {
    if (get().run.status === "running") {
      return;
    }

    const nextInput = get().input.trim();
    if (!nextInput) {
      return;
    }

    const abortController = new AbortController();
    const userMessage = buildUserMessage(nextInput);
    const assistantMessage = buildAssistantPlaceholderMessage();

    set((state) => ({
      abortController,
      input: "",
      run: {
        ...state.run,
        status: "running",
        messages: [...state.run.messages, userMessage, assistantMessage],
      },
    }));

    try {
      const workspaceState = useBookWorkspaceStore.getState();
      const providerConfig = useAgentSettingsStore.getState().config ?? getStoredAgentConfig();
      const enabledSkills = getEnabledSkills(useSkillsStore.getState());
      const enabledAgents = getEnabledAgents(useSubAgentStore.getState());
      const enabledToolsMap = useAgentSettingsStore.getState().enabledTools ?? getStoredEnabledTools();
      const enabledToolIds = Object.entries(enabledToolsMap)
        .filter(([, v]) => v)
        .map(([k]) => k);

      const workspaceTools = workspaceState.rootPath
        ? createWorkspaceToolset({
            onWorkspaceMutated: async () => {
              await useBookWorkspaceStore.getState().refreshWorkspaceAfterExternalChange();
            },
            rootPath: workspaceState.rootPath,
          })
        : {};

      const stream = runAgentTurn({
        abortSignal: abortController.signal,
        activeFilePath: workspaceState.activeFilePath,
        enabledAgents,
        enabledSkills,
        enabledToolIds,
        prompt: nextInput,
        providerConfig,
        workspaceTools,
      });

      for await (const part of stream) {
        set((state) => {
          const messages = [...state.run.messages];
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            messages[messages.length - 1] = {
              ...lastMsg,
              parts: mergePart(lastMsg.parts, part),
            };
          }
          return { run: { ...state.run, messages } };
        });
      }

      set((state) => ({
        abortController: null,
        run: { ...state.run, status: "completed" },
      }));
    } catch (error) {
      if (abortController.signal.aborted) {
        set((state) => ({
          abortController: null,
          run: {
            ...state.run,
            status: "idle",
            messages: state.run.messages.filter((message) => message.id !== assistantMessage.id),
          },
        }));
        return;
      }

      const message = error instanceof Error ? error.message : "Agent 执行失败，请稍后重试。";
      set((state) => ({
        abortController: null,
        run: {
          ...state.run,
          status: "failed",
          messages: [
            ...state.run.messages,
            {
              id: `system-error-${Date.now()}`,
              role: "system",
              author: "系统",
              parts: [{ type: "text", text: message }],
            },
          ],
        },
      }));
    }
  },
  stopMessage: () => {
    const controller = get().abortController;
    if (!controller) {
      return;
    }

    controller.abort();
  },
  setInput: (value) => set({ input: value }),
}));
