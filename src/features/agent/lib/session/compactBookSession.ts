// 手动压缩入口：复用 pi AgentHarness 的原生 compact()，压缩持久 jsonl 会话本身。
//
// 背景：harness 在 runWritingAgentHarness 内按轮创建、流结束即销毁；用户点「压缩」按钮时
// 没有活跃运行、也就没有 harness 实例。但 pi 会话是持久的（per-book .sessions/ jsonl），
// 故这里临时 create-or-open 一个绑同 sessionId 的 harness，仅用于调用 compact()，压缩的是
// 真实会话内容（下一轮模型读到的就是压缩后上下文），与自动压缩（runner 内 maybeCompactSession）
// 走完全相同的机制。压缩完即丢弃临时 harness。

import { createNovelHarness } from "./harnessSession";
import type { WritingRuntimeContext } from "./writingRuntimeContext";

// 网文长会话压缩指令：传给 pi harness.compact() 的 customInstructions，
// 让摘要保留网文创作必需的连续性信息。手动压缩与自动压缩共用此指令。
export const NOVEL_COMPACTION_INSTRUCTIONS = [
  "为网文创作长会话生成可继续写作的高密度上下文摘要。",
  "保留：主线目标、人物状态、世界观设定、写作风格、已完成进展、未完成任务、关键文件路径。",
  "使用简体中文，结构清晰，避免寒暄。",
].join("\n");

export type CompactBookSessionResult = {
  summary: string;
  tokensBefore: number;
  firstKeptEntryId: string;
};

export type CompactBookSessionOptions = {
  sessionId: string;
  bookId: string;
  displayPath: string;
  toolContext: WritingRuntimeContext;
  customInstructions?: string;
  abortSignal?: AbortSignal;
};

export async function compactBookSession(
  options: CompactBookSessionOptions,
): Promise<CompactBookSessionResult> {
  const harness = await createNovelHarness({
    sessionId: options.sessionId,
    bookId: options.bookId,
    displayPath: options.displayPath,
    // prompt 仅用于规划干预判定（已移出 systemPrompt，compact 场景用不到），传空串。
    prompt: "",
    toolContext: options.toolContext,
    abortSignal: options.abortSignal,
  });

  const result = await harness.compact(
    options.customInstructions ?? NOVEL_COMPACTION_INSTRUCTIONS,
  );
  return {
    summary: result.summary,
    tokensBefore: result.tokensBefore,
    firstKeptEntryId: result.firstKeptEntryId,
  };
}
