import { z } from "zod";
import type { ToolSet } from "ai";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { AgentMessage, AgentPart } from "./types";
import { streamAgentText, defineTool } from "./modelGateway";
import type { AgentTool } from "./runtime";

type RunAgentTurnInput = {
  abortSignal?: AbortSignal;
  activeFilePath: string | null;
  enabledSkills: ResolvedSkill[];
  /** 启用的工具 ID 列表 */
  enabledToolIds: string[];
  prompt: string;
  providerConfig: AgentProviderConfig;
  /** workspace 工具集 */
  workspaceTools: Record<string, AgentTool>;
  /** 可选：用于测试注入的流式调用 */
  _streamFn?: typeof streamAgentText;
};

function hasProviderConfig(config: AgentProviderConfig) {
  return Boolean(config.apiKey.trim() && config.baseURL.trim() && config.model.trim());
}

function buildSystemPrompt(enabledSkills: ResolvedSkill[]) {
  const skillBlock =
    enabledSkills.length > 0
      ? enabledSkills
          .map((skill) => {
            const referenceBlock =
              skill.references.length > 0
                ? `\n参考资料: ${skill.references.map((entry) => entry.path).join(", ")}`
                : "";
            return [
              `## 技能: ${skill.name}`,
              `来源: ${skill.sourceLabel}`,
              `说明: ${skill.description}`,
              skill.suggestedTools.length > 0
                ? `推荐工具: ${skill.suggestedTools.join(", ")}`
                : "推荐工具: 无",
              `技能内容:\n${skill.effectivePrompt}`,
              referenceBlock,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n")
      : "- 当前未启用额外技能";

  return [
    "你是桌面端 AI 小说写作工作台中的主代理。",
    "你的任务是结合当前章节内容、启用技能和工具结果，为用户提供可执行的创作输出。",
    "请优先保持中文输出，结构清晰，适合小说创作工作流。",
    "你可以使用提供的工具来读取和操作工作区中的文件。",
    "已启用技能：",
    skillBlock,
  ].join("\n");
}

/** 把 workspace 工具转成 AI SDK ToolSet 格式 */
function buildAiSdkTools(
  workspaceTools: Record<string, AgentTool>,
  enabledToolIds: string[],
): ToolSet {
  const toolSet: ToolSet = {};
  const enabledSet = new Set(enabledToolIds);

  // read_file 工具
  if (enabledSet.has("read_file") && workspaceTools.read_file) {
    const wsTool = workspaceTools.read_file;
    toolSet.read_file = defineTool({
      description: wsTool.description,
      inputSchema: z.object({
        path: z.string().describe("要读取的文件路径"),
      }),
      execute: async (input: { path: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  // write_file 工具
  if (enabledSet.has("write_file") && workspaceTools.write_file) {
    const wsTool = workspaceTools.write_file;
    toolSet.write_file = defineTool({
      description: wsTool.description,
      inputSchema: z.object({
        path: z.string().describe("要写入的文件路径"),
        contents: z.string().describe("要写入的内容"),
      }),
      execute: async (input: { path: string; contents: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  // create_file 工具
  if (enabledSet.has("create_file") && workspaceTools.create_file) {
    const wsTool = workspaceTools.create_file;
    toolSet.create_file = defineTool({
      description: wsTool.description,
      inputSchema: z.object({
        parentPath: z.string().describe("父目录路径"),
        name: z.string().describe("文件名"),
      }),
      execute: async (input: { parentPath: string; name: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  // create_folder 工具
  if (enabledSet.has("create_folder") && workspaceTools.create_folder) {
    const wsTool = workspaceTools.create_folder;
    toolSet.create_folder = defineTool({
      description: wsTool.description,
      inputSchema: z.object({
        parentPath: z.string().describe("父目录路径"),
        name: z.string().describe("文件夹名"),
      }),
      execute: async (input: { parentPath: string; name: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  // delete_path 工具
  if (enabledSet.has("delete_path") && workspaceTools.delete_path) {
    const wsTool = workspaceTools.delete_path;
    toolSet.delete_path = defineTool({
      description: wsTool.description,
      inputSchema: z.object({
        path: z.string().describe("要删除的路径"),
      }),
      execute: async (input: { path: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  // rename_path 工具
  if (enabledSet.has("rename_path") && workspaceTools.rename_path) {
    const wsTool = workspaceTools.rename_path;
    toolSet.rename_path = defineTool({
      description: wsTool.description,
      inputSchema: z.object({
        path: z.string().describe("当前路径"),
        nextName: z.string().describe("新名称"),
      }),
      execute: async (input: { path: string; nextName: string }) => {
        const result = await wsTool.execute(input);
        return result.summary;
      },
    });
  }

  // read_workspace_tree 工具
  if (enabledSet.has("read_workspace_tree") && workspaceTools.read_workspace_tree) {
    const wsTool = workspaceTools.read_workspace_tree;
    toolSet.read_workspace_tree = defineTool({
      description: wsTool.description,
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>) => {
        const result = await wsTool.execute({});
        return result.data ?? result.summary;
      },
    });
  }

  return toolSet;
}

function createSystemMessage(text: string): AgentMessage {
  return {
    id: `system-${Date.now()}`,
    role: "system",
    author: "系统",
    parts: [{ type: "text", text }],
  };
}

/**
 * 运行一轮 agent 对话，以 async generator 形式逐步 yield AgentPart。
 * 调用方可实时消费每个 part 更新 UI。
 */
export async function* runAgentTurn({
  abortSignal,
  activeFilePath,
  enabledSkills,
  enabledToolIds,
  prompt,
  providerConfig,
  workspaceTools,
  _streamFn = streamAgentText,
}: RunAgentTurnInput): AsyncGenerator<AgentPart> {
  if (!hasProviderConfig(providerConfig)) {
    yield { type: "text", text: "请先前往设置页配置 Base URL、API Key 和模型名称，再运行 Agent。" };
    return;
  }

  const system = buildSystemPrompt(enabledSkills);
  const aiTools = buildAiSdkTools(workspaceTools, enabledToolIds);

  // 构建用户消息，包含文件上下文
  let userContent = prompt;
  if (activeFilePath) {
    userContent = `[当前活动文件: ${activeFilePath}]\n\n${prompt}`;
  }

  const result = _streamFn({
    abortSignal,
    messages: [{ role: "user", content: userContent }],
    providerConfig,
    system,
    tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        yield { type: "text-delta", delta: part.text };
        break;

      case "reasoning-delta":
        yield {
          type: "reasoning",
          summary: "思考中...",
          detail: part.text,
        };
        break;

      case "tool-call":
        yield {
          type: "tool-call",
          toolName: part.toolName,
          status: "running",
          inputSummary: JSON.stringify(part.input),
        };
        break;

      case "tool-result":
        yield {
          type: "tool-result",
          toolName: part.toolName,
          status: "completed",
          outputSummary: typeof part.output === "string" ? part.output : JSON.stringify(part.output),
        };
        break;

      default:
        // 忽略其他 stream part 类型（start-step, finish-step 等）
        break;
    }
  }
}

export { createSystemMessage };
