import type { ToolSet } from "ai";
import type { AgentPart } from "../types";

const WRITE_TOOL_IDS = new Set(["workspace_write", "workspace_edit", "workspace_json"]);
const MAX_REPAIR_TEXT_CHARS = 1200;

export type WriteProtocolRepairConfig = {
  enabledToolIds?: readonly string[];
  userPrompt?: string;
};

export type WriteProtocolRepairInput = {
  config?: WriteProtocolRepairConfig;
  finishReason?: string;
  parts: readonly AgentPart[];
  repairCount: number;
  tools?: ToolSet;
};

function hasEnabledWriteTool(config?: WriteProtocolRepairConfig, tools?: ToolSet) {
  const enabledToolIds = config?.enabledToolIds ?? Object.keys(tools ?? {});
  return enabledToolIds.some((id) => WRITE_TOOL_IDS.has(id));
}

export function hasWriteToolCall(parts: readonly AgentPart[]) {
  return parts.some((part) =>
    (part.type === "tool-call" || part.type === "tool-result")
    && WRITE_TOOL_IDS.has(part.toolName)
  );
}

function extractPartText(part: AgentPart) {
  if (part.type === "text") return part.text;
  if (part.type === "text-delta") return part.delta;
  if (part.type === "reasoning") return part.detail;
  return "";
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, limit = MAX_REPAIR_TEXT_CHARS) {
  const normalized = normalizeText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trim()}...`;
}

function collectAssistantText(parts: readonly AgentPart[]) {
  return truncateText(parts.map(extractPartText).filter(Boolean).join("\n"));
}

function explicitlyDisablesWriteBack(text: string) {
  return [
    /(?:不要|无需|不用|不必).{0,24}(?:写入|保存|落盘|回写|改文件|修改文件|调用工具|用工具)/i,
    /(?:只|仅).{0,12}(?:在对话|回复|解释|分析|给出原因|给方案|给提示词)/i,
    /(?:do not|don't|dont|no need to).{0,40}(?:write|save|edit|update|call tools?|use tools?)/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeDiagnosticOnly(text: string) {
  return [
    /(?:为什么|原因|诊断|分析|解释).{0,40}(?:没有|未|不会|不能).{0,40}(?:写|调用|执行|落盘)/,
    /(?:是什么原因|给出原因|什么原因).{0,40}(?:没有|未|不会|不能).{0,40}(?:写|调用|执行|落盘)/,
    /\b(?:why|reason|diagnose|explain)\b.{0,80}\b(?:not|failed|without)\b.{0,80}\b(?:write|tool|save|call)\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikePromptDraftRequest(text: string) {
  if (!/(?:提示词|prompt)/i.test(text)) return false;
  return !/(?:写入|保存|落盘|回写|更新|修改|创建|新建).{0,24}(?:文件|工作区|workspace|file|document)/i.test(text);
}

function looksLikeWriteTask(text: string) {
  if (
    !text
    || explicitlyDisablesWriteBack(text)
    || looksLikeDiagnosticOnly(text)
    || looksLikePromptDraftRequest(text)
  ) {
    return false;
  }
  return [
    /(?:继续|直接|开始|现在|马上|帮我|请|把|将|完成|执行|补齐|补完).{0,48}(?:写|续写|撰写|创作|生成|改写|修改|润色|编辑|补写|扩写|追加|保存|落盘|写入|回写|更新|创建|新建)/i,
    /(?:写|续写|撰写|创作|生成|改写|修改|润色|编辑|补写|扩写|追加|保存|落盘|写入|回写|更新|创建|新建).{0,48}(?:章节|正文|第\s*\d+\s*章|文件|工作区|大纲|设定|角色|状态|剧情|细纲|卷纲|内容|文本|稿|文档|json)/i,
    /\b(?:write|draft|compose|continue|rewrite|edit|polish|append|save|update|create)\b.{0,80}\b(?:chapter|file|workspace|document|draft|outline|json|status|content|text)\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeContinuation(text: string) {
  return /^(?:继续|继续执行|继续写|接着来|接着写|continue|go on)$/i.test(text.trim());
}

function looksLikeAssistantWriteIntent(text: string) {
  if (!text) return false;
  return [
    /(?:now let me write|let me write|i will write|i'll write|starting chapter|continue the chapter)/i,
    /(?:现在|马上|直接|开始|继续|接着).{0,32}(?:写|续写|开写|落盘|写入|保存|回写|更新)/,
    /(?:第\s*\d+\s*章|chapter\s*\d+).{0,48}(?:开写|续写|开始|承接|继续|write|continue)/i,
  ].some((pattern) => pattern.test(text));
}

function shouldConsiderRepair(userPrompt: string, assistantText: string) {
  return looksLikeWriteTask(userPrompt)
    || (looksLikeContinuation(userPrompt) && looksLikeAssistantWriteIntent(assistantText))
    || looksLikeAssistantWriteIntent(assistantText);
}

export function buildWriteProtocolRepairPrompt(params: {
  assistantText: string;
  userPrompt: string;
}) {
  const goal = truncateText(params.userPrompt) || "继续刚才未完成的写入任务。";
  const lastIntent = truncateText(params.assistantText) || "上一轮以普通文本结束，没有调用写入工具。";

  return [
    "协议修复：你上一轮已经表达了将继续执行/继续写入的意图，或当前任务要求写回工作区，但你没有实际调用写入工具，所以应用没有执行任何写入操作。",
    "",
    "这条消息由应用后台触发，用于继续当前任务；不要在最终回复中提及本协议修复，也不要把它当作用户新增需求展示。",
    "",
    "现在请从刚才的断点继续执行，不要重复解释，不要重述计划，不要再输出“现在开始写”“Now let me write...”这类承诺性自然语言来代替工具调用。",
    "",
    "本轮要求：",
    "1. 你的目标是继续完成刚才已经承诺要执行的工作，而不是重新讨论是否执行。",
    "2. 如果缺少路径、上文、角色状态、伏笔、章节衔接点或状态文件证据，先调用 `workspace_search` 检索；只对最相关的少量文件再调用 `workspace_read` 精读。",
    "3. 一旦信息足够，必须立即调用相关写入工具完成落盘：",
    "   - 新写整段/整章/大块续写：`workspace_write`",
    "   - 修改已有正文局部内容：`workspace_edit`",
    "   - 维护 `.project/status/*.json` 等状态数据：`workspace_json`",
    "4. 写入完成后，做最小必要核对；可用 `workspace_read`、`text_stats` 或 `workspace_json` 验证。",
    "5. 最后再给出简短结果汇报。",
    "",
    "硬约束：",
    "- 如果当前任务本质上是“创作 / 续写 / 保存 / 回写 / 更新文件”，本轮不能只输出普通文本，必须至少产生一次相关工具调用。",
    "- 不要把正文先发在对话里然后停止。",
    "- 不要重复上一轮已经说过的承诺句。",
    "- 只有在缺少关键事实且无法安全决定时，才允许向用户提问。",
    "- 优先延续当前工作区已有路径和结构；未知路径先 search，再 read，再 write。",
    "",
    "当前要继续的任务：",
    goal,
    "",
    "上一轮你已经说过但尚未执行的意图：",
    lastIntent,
  ].join("\n");
}

export function getWriteProtocolRepairPrompt({
  config,
  finishReason,
  parts,
  repairCount,
  tools,
}: WriteProtocolRepairInput) {
  if (!config || repairCount > 0) return null;
  if (finishReason && finishReason !== "stop") return null;
  if (!hasEnabledWriteTool(config, tools) || hasWriteToolCall(parts)) return null;

  const userPrompt = truncateText(config.userPrompt ?? "");
  const assistantText = collectAssistantText(parts);
  if (!shouldConsiderRepair(userPrompt, assistantText)) return null;

  return buildWriteProtocolRepairPrompt({ assistantText, userPrompt });
}


