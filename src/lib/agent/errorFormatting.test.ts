import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { formatProviderError } from "./errorFormatting";

describe("formatProviderError", () => {
  it("展开网络类 APICallError 的请求地址、模型和底层原因", () => {
    const error = new APICallError({
      cause: new Error("connect ECONNREFUSED 127.0.0.1:11434"),
      message: "Network error",
      requestBodyValues: { model: "deepseek-chat" },
      url: "https://api.example.com/v1/chat/completions",
    });

    expect(formatProviderError(error, "模型调用失败。")).toContain("模型调用失败：无法连接到模型服务。");
    expect(formatProviderError(error, "模型调用失败。")).toContain(
      "请求地址：https://api.example.com/v1/chat/completions",
    );
    expect(formatProviderError(error, "模型调用失败。")).toContain("模型：deepseek-chat");
    expect(formatProviderError(error, "模型调用失败。")).toContain(
      "底层原因：connect ECONNREFUSED 127.0.0.1:11434",
    );
  });

  it("展开 HTTP 错误的状态码与服务端返回消息", () => {
    const error = new APICallError({
      message: "Bad Request",
      requestBodyValues: { model: "gpt-4.1" },
      responseBody: JSON.stringify({
        error: {
          message: "Unsupported parameter: tools",
        },
      }),
      statusCode: 400,
      url: "https://api.example.com/v1/chat/completions",
    });

    const formatted = formatProviderError(error, "模型调用失败。");
    expect(formatted).toContain("模型调用失败（HTTP 400）。");
    expect(formatted).toContain("服务端返回：Unsupported parameter: tools");
    expect(formatted).toContain("模型：gpt-4.1");
  });

  it("普通 Error 也会补充上下文信息", () => {
    const error = new Error("network error") as Error & { cause?: unknown };
    error.cause = { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND api.example.com" };

    const formatted = formatProviderError(error, "模型调用失败。", {
      baseURL: "https://api.example.com/v1",
      model: "gpt-4.1",
    });

    expect(formatted).toContain("模型调用失败：无法连接到模型服务。");
    expect(formatted).toContain("请求地址：https://api.example.com/v1");
    expect(formatted).toContain("模型：gpt-4.1");
    expect(formatted).toContain("底层原因：ENOTFOUND: getaddrinfo ENOTFOUND api.example.com");
  });
});
