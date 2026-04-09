import { z } from "zod";
import type { ToolSet } from "ai";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { ResolvedSkill } from "../../stores/skillsStore";
import type { AgentMessage, AgentPart } from "./types";
import { generateAgentText, streamAgentText, defineTool } from "./modelGateway";
import type { AgentTool } from "./runtime";
import type { ResolvedAgent } from "../../stores/subAgentStore";

type RunAgentTurnInput = {
  abortSignal?: AbortSignal;
  activeFilePath: string | null;
  enabledAgents: ResolvedAgent[];
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

function buildAgentPromptBlock(agent: ResolvedAgent) {
  return [
    `### 代理: ${agent.name}`,
    `来源: ${agent.sourceLabel}`,
    agent.role ? `角色: ${agent.role}` : null,
    `说明: ${agent.description}`,
    agent.dispatchHint ? `委派时机: ${agent.dispatchHint}` : null,
    agent.suggestedTools.length > 0 ? `推荐工具: ${agent.suggestedTools.join(", ")}` : "推荐工具: 无",
    `AGENTS.md:\n${agent.body}`,
    agent.toolsPreview ? `TOOLS.md 摘要:\n${agent.toolsPreview}` : null,
    agent.memoryPreview ? `MEMORY.md 摘要:\n${agent.memoryPreview}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemPrompt(enabledSkills: ResolvedSkill[], enabledAgents: ResolvedAgent[]) {
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
              skill.suggestedTools.length > 0 ? `推荐工具: ${skill.suggestedTools.join(", ")}` : "推荐工具: 无",
              `技能内容:\n${skill.effectivePrompt}`,
              referenceBlock,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n")
      : "- 当前未启用额外技能";

  const agentBlock =
    enabledAgents.length > 0
      ? enabledAgents.map((agent) => buildAgentPromptBlock(agent)).join("\n\n")
      : "- 当前未启用可委派代理";

  return [
    "你是桌面端 AI 小说写作工作台中的主代理。",
    "你的任务是结合当前章节内容、启用技能、已启用代理和工具结果，为用户提供可执行的创作输出。",
    "请优先保持中文输出，结构清晰，适合小说创作工作流。",
    "你可以使用提供的工具来读取和操作工作区中的文件。",
    "当某个任务明显更适合交给某个已启用代理时，请先综合该代理的身份、工具说明与记忆，再输出结果。",
    "你可以直接吸收代理内容后作答，也可以在心中先让对应代理完成一次子分析，但最终回复仍由你统一给出。",
    "已启用技能：",
    skillBlock,
    "已启用代理：",
    agentBlock,
  ].join("\n");
}

function buildSubAgentSystem(agent: ResolvedAgent, enabledSkills: ResolvedSkill[]) {
  const skillSummary =
    enabledSkills.length > 0
      ? enabledSkills
          .map((skill) => `- ${skill.name}：${skill.description}\n${skill.effectivePrompt}`)
          .join("\n\n")
      : "- 当前没有额外技能";

  return [
    `你现在扮演子代理：${agent.name}。`,
    agent.role ? `你的角色是：${agent.role}。` : null,
    `代理说明：${agent.description}`,
    agent.dispatchHint ? `适合接手的任务：${agent.dispatchHint}` : null,
    "以下是你的 AGENTS.md：",
    agent.body,
    agent.toolsPreview ? `以下是你的 TOOLS.md 摘要：\n${agent.toolsPreview}` : null,
    agent.memoryPreview ? `以下是你的 MEMORY.md 摘要：\n${agent.memoryPreview}` : null,
    enabledSkills.length > 0 ? `可参考的技能：\n${skillSummary}` : null,
    "请只返回你的专业分析、改写建议或正文结果，不要解释你是子代理。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function maybeRunSubAgent(params: {
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  prompt: string;
  providerConfig: AgentProviderConfig;
}): Promise<{ agent: ResolvedAgent; text: string } | null> {
  const { enabledAgents, enabledSkills, prompt, providerConfig } = params;
  if (enabledAgents.length === 0) {
    return null;
  }

  const normalizedPrompt = prompt.toLowerCase();
  const matchedAgent =
    enabledAgents.find((agent) => agent.tags.some((tag) => normalizedPrompt.includes(tag.toLowerCase()))) ??
    enabledAgents.find((agent) => agent.role && normalizedPrompt.includes(agent.role.toLowerCase())) ??
    enabledAgents.find((agent) => agent.dispatchHint && normalizedPrompt.includes(agent.dispatchHint.toLowerCase())) ??
    enabledAgents[0];

  const subagentPrompt = [
    "请基于以下用户请求给出你的专业结果。",
    prompt,
  ].join("\n\n");

  const text = await generateAgentText({
    prompt: subagentPrompt,
    providerConfig,
    system: buildSubAgentSystem(matchedAgent, enabledSkills),
  });

  return {
    agent: matchedAgent,
    text,
  };
}

/** 把 workspace 工具转成 AI SDK ToolSet 格式 */
function buildAiSdkTools(
  workspaceTools: Record<string, AgentTool>,
  enabledToolIds: string[],
): ToolSet {
  const toolSet: ToolSet = {};
  const enabledSet = new Set(enabledToolIds);

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
  enabledAgents,
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

  const maybeSubAgent = await maybeRunSubAgent({
    enabledAgents,
    enabledSkills,
    prompt,
    providerConfig,
  });

  if (maybeSubAgent) {
    yield {
      type: "subagent",
      name: maybeSubAgent.agent.name,
      status: "completed",
      summary: `已委派给 ${maybeSubAgent.agent.name}`,
      detail: maybeSubAgent.text,
    };
  }

  const system = buildSystemPrompt(enabledSkills, enabledAgents);
  const aiTools = buildAiSdkTools(workspaceTools, enabledToolIds);

  let userContent = prompt;
  if (activeFilePath) {
    userContent = `[当前活动文件: ${activeFilePath}]\n\n${prompt}`;
  }
  if (maybeSubAgent) {
    userContent += `\n\n[子代理 ${maybeSubAgent.agent.name} 的预分析]\n${maybeSubAgent.text}`;
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
        break;
    }
  }
}

export { createSystemMessage };
