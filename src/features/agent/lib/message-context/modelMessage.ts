// 应用内部的「历史会话消息」契约类型。
//
// 背景：本类型原先复用 AI SDK 的 `ModelMessage`。pi 重构（CP4.6）卸载 `ai` 依赖后，
// 历史消息的序列化/重建不再属于任何 SDK，应由项目自有类型承载。这里精确复刻
// message-context 序列化层 + modelMessagesToPi 实际用到的形态子集，保持行为不变。
//
// 注意：本项目开发阶段不迁移旧会话数据，本类型仅用于「同一会话内继续对话」时
// 重建上下文（serialization → ModelMessage[] → modelMessagesToPi → pi Message[]）。

/** 文本块。 */
export type TextPart = {
  type: "text";
  text: string;
};

/** 推理（思考）块。assistant 内容中可能出现，序列化时并入文本。 */
export type ReasoningPart = {
  type: "reasoning";
  text: string;
};

/** 工具调用块（assistant 内容）。input 为已解析的参数对象。 */
export type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};

/** 工具结果的输出载荷：文本 / JSON / 错误文本 / 错误 JSON。 */
export type ToolResultOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: unknown }
  | { type: "error-text"; value: string }
  | { type: "error-json"; value: unknown };

/** 工具结果块（tool 角色消息内容）。 */
export type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput;
};

export type UserModelMessage = {
  role: "user";
  content: string | TextPart[];
};

export type AssistantModelMessage = {
  role: "assistant";
  content: string | Array<TextPart | ReasoningPart | ToolCallPart>;
};

export type ToolModelMessage = {
  role: "tool";
  content: ToolResultPart[];
};

/**
 * 历史会话消息（取代 AI SDK 的 ModelMessage）。
 * 仅含本项目序列化/重建实际使用的 user / assistant / tool 三种角色。
 */
export type ModelMessage = UserModelMessage | AssistantModelMessage | ToolModelMessage;
