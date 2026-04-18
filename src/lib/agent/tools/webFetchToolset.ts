import type { AgentTool } from "../runtime";
import { ensureString, ok } from "./shared";
import { webFetchService } from "./webFetchService";

function formatFetchSummary(title: string, textLength: number, truncated: boolean) {
  return [
    `已读取网页《${title || "未命名网页"}》。`,
    `正文长度：${textLength} 字符。`,
    truncated ? "当前结果已按 maxChars 裁剪。" : "当前结果为完整抽取正文。",
  ].join(" ");
}

export function createWebFetchTools(): Record<string, AgentTool> {
  return {
    web_fetch: {
      description: "读取网页正文并提取主要文本",
      execute: async (input) => {
        const url = ensureString(input.url, "web_fetch.url");
        const response = await webFetchService.fetch(
          url,
          typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
            ? Math.trunc(input.maxChars)
            : undefined,
        );

        if (!response.success) {
          return ok(`网页读取失败：${response.error ?? "未知错误"}`, response);
        }

        return ok(
          formatFetchSummary(
            response.title,
            response.textLength,
            response.truncated,
          ),
          response,
        );
      },
    },
  };
}
