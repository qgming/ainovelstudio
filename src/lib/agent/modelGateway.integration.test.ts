import { describe, expect, it } from "vitest";
import { testAgentProviderConnection } from "./modelGateway";

const hasRealProviderEnv =
  Boolean(process.env.REAL_PROVIDER_BASE_URL) &&
  Boolean(process.env.REAL_PROVIDER_API_KEY) &&
  Boolean(process.env.REAL_PROVIDER_MODEL);

const describeIfRealEnv = hasRealProviderEnv ? describe : describe.skip;

describeIfRealEnv("modelGateway integration", () => {
  it("使用真实模型配置时能收到有效响应", async () => {
    const result = await testAgentProviderConnection({
      apiKey: process.env.REAL_PROVIDER_API_KEY ?? "",
      baseURL: process.env.REAL_PROVIDER_BASE_URL ?? "",
      model: process.env.REAL_PROVIDER_MODEL ?? "",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("success");
    expect(result.stage).toBe("response");
    expect(result.diagnostics.responseTextPreview).toBeTruthy();
  });
});
