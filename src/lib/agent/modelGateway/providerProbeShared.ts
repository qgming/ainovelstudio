import type { AgentProviderConfig } from "../../../stores/agentSettingsStore";

export type ProviderConnectionTestStage = "config" | "request" | "response";
export type ProviderConnectionTestStatus =
  | "success"
  | "config_error"
  | "auth_error"
  | "network_error"
  | "model_error"
  | "response_invalid"
  | "unknown_error";

export type ProviderConnectionTestResult = {
  ok: boolean;
  status: ProviderConnectionTestStatus;
  stage: ProviderConnectionTestStage;
  message: string;
  provider: {
    baseURL: string;
    model: string;
  };
  diagnostics: {
    contentTypes?: string[];
    durationMs?: number;
    finishReason?: string;
    httpStatus?: number;
    rawFinishReason?: string;
    responseTextPreview?: string;
  };
};

export type ProbeContentPart = {
  type?: string;
  text?: string;
};

export type ProbeGenerateResult = {
  content?: ProbeContentPart[];
  finishReason?: string;
  rawFinishReason?: string;
};

export type ProviderConfigValidationResult =
  | { ok: true; normalizedConfig: AgentProviderConfig }
  | { ok: false; result: ProviderConnectionTestResult };

export type ProbeExecutionSuccess = {
  durationMs: number;
  result: ProbeGenerateResult;
};

export type ProbeExecutionFailure = {
  durationMs: number;
  error: unknown;
};

export function createTestResult(
  providerConfig: Pick<AgentProviderConfig, "baseURL" | "model">,
  result: Omit<ProviderConnectionTestResult, "provider">,
): ProviderConnectionTestResult {
  return {
    ...result,
    provider: {
      baseURL: providerConfig.baseURL,
      model: providerConfig.model,
    },
  };
}

export function includesAnyKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}
