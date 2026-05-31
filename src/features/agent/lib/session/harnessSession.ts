// CP-C：基于 pi AgentHarness 组装写作 Agent。
//
// 取代旧 runWritingAgentPi 的低层 runAgentLoop 调用。AgentHarness 自带会话持久化
// （JsonlSessionRepo，落 per-book .sessions/）、steer/followUp/nextTurn 队列、
// 以及 on() 钩子（tool_call 审批 / tool_result 终止 / context 物料注入）。
//
// 会话复用策略（用户决策「持久会话跨轮复用」）：每个应用 sessionId 对应一个持久
// pi jsonl 会话，create-or-open。pi session 成为 agent 上下文的真实来源，历史不再
// 每轮重新注入；app chat store 仅用于 UI 渲染（CP-G 才统一收口）。

import { AgentHarness, JsonlSessionRepo, formatSkillsForSystemPrompt } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getPlanningIntervention } from "../planning";
import { buildRuntimeControlBlock, buildSystemPrompt } from "../promptContext";
import { buildPiTools } from "../pi/buildPiTools";
import { toPiModel, toPiThinkingLevel } from "../pi/models";
import { buildProviderRequestHeaders } from "../providerRequest";
import type { WritingRuntimeContext } from "../writingRuntimeContext";
import { createTauriExecutionEnv } from "./env/tauriExecutionEnv";
import { createSessionFileSystem } from "./env/sessionExecutionEnv";
import { loadNovelSkills } from "./skills/loadNovelSkills";

export type CreateNovelHarnessOptions = {
  /** 应用会话 id，用作 pi 持久会话的确定性 id（create-or-open）。 */
  sessionId: string;
  /** 解析用：书籍标识（UUID），定位真实文件 env 与 per-book .sessions/，并作为会话归档 cwd。 */
  bookId: string;
  /** 展示用：工作区可读根串（books/<书名>），供 env cwd/路径解析与系统提示展示。 */
  displayPath: string;
  /** 当前轮用户 prompt，用于规划干预判定（注入系统提示的运行时控制块）。 */
  prompt: string;
  toolContext: WritingRuntimeContext;
  abortSignal?: AbortSignal;
};

// pi 会话目录用 cwd 归档（encodeCwd）。这里固定用 bookId 作为 cwd，
// 让同一本书的会话归到同一子目录，便于 list/open 复用（书名可改，UUID 稳定）。
function sessionCwd(bookId: string): string {
  return bookId;
}

/**
 * create-or-open：按确定性 id 复用持久会话。
 * 先 list 当前书目录下的会话元信息，命中同 id 则 open，否则 create。
 */
async function createOrOpenBookSession(
  repo: JsonlSessionRepo,
  bookId: string,
  sessionId: string,
) {
  const cwd = sessionCwd(bookId);
  const existing = await repo.list({ cwd }).catch(() => []);
  const hit = existing.find((meta) => meta.id === sessionId);
  if (hit) {
    return repo.open(hit);
  }
  return repo.create({ cwd, id: sessionId });
}

/**
 * 组装一个绑定到指定书 + 会话的 AgentHarness。
 * 仅完成静态装配（env/session/model/tools/systemPrompt/auth）；
 * 控制流钩子（tool_call/tool_result/context/turn_end）由 harnessControl 注册。
 */
export async function createNovelHarness(options: CreateNovelHarnessOptions): Promise<AgentHarness> {
  const { sessionId, bookId, displayPath, toolContext } = options;

  const env = createTauriExecutionEnv({ bookId, displayPath });
  const sessionFs = createSessionFileSystem({ bookId });
  // sessionsRoot 用空串：根即 .sessions/，pi 在其下按 encodeCwd(cwd) 建子目录。
  const repo = new JsonlSessionRepo({ fs: sessionFs, sessionsRoot: "" });
  const session = await createOrOpenBookSession(repo, bookId, sessionId);

  const model: Model<"openai-completions"> = toPiModel(toolContext.providerConfig);
  const thinkingLevel = toPiThinkingLevel(toolContext.providerConfig);

  const tools = buildPiTools({
    workspaceTools: toolContext.workspaceTools,
    enabledToolIds: toolContext.enabledToolIds,
    abortSignal: options.abortSignal,
    onToolRequestStateChange: toolContext.onToolRequestStateChange,
    onAskUser: toolContext.onAskUser,
  });

  // CP-E：技能改用 pi 原生 loadSkills 从真实 skills 目录加载（按启用 id 过滤），
  // 注入 harness.resources.skills，并用 formatSkillsForSystemPrompt 渲染系统提示技能段。
  // 加载失败（如目录缺失）不应阻断会话，降级为无技能。
  const enabledSkillIds = toolContext.enabledSkills.map((skill) => skill.id);
  const piSkills = enabledSkillIds.length
    ? await loadNovelSkills(enabledSkillIds)
        .then((result) => result.skills)
        .catch(() => [])
    : [];

  const systemPrompt = [
    buildSystemPrompt({
      defaultAgentMarkdown: toolContext.defaultAgentMarkdown,
      enabledSkills: toolContext.enabledSkills,
      enabledToolIds: toolContext.enabledToolIds,
      mode: toolContext.mode,
      modeContext: toolContext.modeContext,
      // 技能目录改由 pi formatSkillsForSystemPrompt 渲染，关掉自研技能目录段（工具段保留）。
      includeSkillCatalog: false,
    }),
    // pi spec 兼容的技能系统提示块（仅启用的技能）。
    piSkills.length ? formatSkillsForSystemPrompt(piSkills) : "",
    // 运行时控制块（含规划干预/工作区元信息）属系统级可信元数据，放系统提示。
    // 会话每轮创建新 harness，故 planning 状态在此已是当轮最新值。
    buildRuntimeControlBlock({
      planningIntervention: getPlanningIntervention(toolContext.planningState, options.prompt),
      planningState: toolContext.planningState,
      workspaceRootPath: toolContext.workspaceRootPath,
    }),
  ]
    .filter((section) => section.trim())
    .join("\n\n");

  const apiKey = toolContext.providerConfig.apiKey.trim();

  const harness = new AgentHarness({
    env,
    session,
    model,
    thinkingLevel,
    tools,
    systemPrompt,
    resources: { skills: piSkills },
    // 认证：pi createStreamFn 每次请求调用，注入 apiKey + provider 头。
    getApiKeyAndHeaders: async () => ({
      apiKey,
      headers: buildProviderRequestHeaders(toolContext.providerConfig),
    }),
  });

  return harness;
}
