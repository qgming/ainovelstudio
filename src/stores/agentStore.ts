/**
 * 兼容层：老路径 `stores/agentStore`。
 * 新代码请改用 `stores/chatRunStore`。本文件仅做 re-export，迁移完成后可删除。
 */
export {
  useAgentStore,
  useChatRunStore,
  selectIsAgentRunActive,
  type AgentStore,
  type ChatRunStore,
} from "./chatRunStore";
