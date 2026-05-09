import type { AgentTool } from "../runtime";
import { ensureString, ok } from "./shared";
import type { WebFetchResponse } from "./webSearchTypes";
import { webFetchService } from "./webFetchService";

function formatFetchSummary(response: WebFetchResponse) {
  return [
    `已读取网页《${response.title || "未命名网页"}》。`,
    response.mode && response.mode !== "full"
      ? `提取模式：${response.mode}。`
      : null,
    `正文长度：${response.textLength} 字符。`,
    response.links ? `结构化链接：${response.links.length} 条。` : null,
    response.tables ? `结构化表格：${response.tables.length} 个。` : null,
    response.truncated ? "当前结果已按 maxChars 裁剪。" : "当前结果为完整抽取正文。",
  ]
    .filter(Boolean)
    .join(" ");
}

export function createWebFetchTools(): Record<string, AgentTool> {
  return {
    web_fetch: {
      description: "读取网页正文并提取主要文本",
      execute: async (input) => {
        const url = ensureString(input.url, "web_fetch.url");
        const mode =
          input.mode === "anchor_range" || input.mode === "heading_range"
            ? input.mode
            : "full";
        const response = await webFetchService.fetch(
          url,
          typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
            ? Math.trunc(input.maxChars)
            : undefined,
          {
            afterBlocks:
              typeof input.afterBlocks === "number" &&
              Number.isFinite(input.afterBlocks)
                ? Math.trunc(input.afterBlocks)
                : undefined,
            anchor:
              typeof input.anchor === "string" && input.anchor.trim()
                ? input.anchor.trim()
                : undefined,
            beforeBlocks:
              typeof input.beforeBlocks === "number" &&
              Number.isFinite(input.beforeBlocks)
                ? Math.trunc(input.beforeBlocks)
                : undefined,
            caseSensitive: Boolean(input.caseSensitive),
            heading:
              typeof input.heading === "string" && input.heading.trim()
                ? input.heading.trim()
                : undefined,
            includeLinks: Boolean(input.includeLinks),
            includeTables: Boolean(input.includeTables),
            mode,
            occurrence:
              typeof input.occurrence === "number" &&
              Number.isFinite(input.occurrence)
                ? Math.trunc(input.occurrence)
                : undefined,
          },
        );

        if (!response.success) {
          return ok(`网页读取失败：${response.error ?? "未知错误"}`, response);
        }

        return ok(
          formatFetchSummary(response),
          response,
        );
      },
    },
  };
}
