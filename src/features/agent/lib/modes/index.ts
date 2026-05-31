// CP-F：模式注册表。getModeConfig 是访问模式策略的统一入口。

import type { AgentMode } from "./modeRules";
import { autopilotMode } from "./autopilotMode";
import { bookMode } from "./bookMode";
import type { ModeConfig } from "./types";

export const MODE_CONFIGS = {
  book: bookMode,
  autopilot: autopilotMode,
} as const;

/**
 * 取某模式的策略定义；未传或未知模式回退到 book。
 *
 * 返回类型按入参收窄到具体 ModeConfig<M>，使调用方拿到精确的 modeContext 类型。
 */
export function getModeConfig<M extends AgentMode>(mode: M): ModeConfig<M>;
export function getModeConfig(mode: AgentMode | undefined): ModeConfig;
export function getModeConfig(mode: AgentMode | undefined): ModeConfig {
  if (mode && mode in MODE_CONFIGS) {
    return MODE_CONFIGS[mode] as ModeConfig;
  }
  return bookMode as ModeConfig;
}

export type { ModeConfig, ContinuationInput, ContinuationDecision, ToolApprovalInput, ToolApprovalDecision } from "./types";
