import type { AgentTool } from "../runtime";
import { ensureString, ok } from "./shared";
import { searxngSearchService } from "./searxngSearchService";

function formatSearchSummary(query: string, resultCount: number, instance: string) {
  if (resultCount === 0) {
    return `已搜索“${query}”，当前没有返回结果。`;
  }

  return `已搜索“${query}”，通过 ${instance} 返回 ${resultCount} 条结果。`;
}

export function createWebSearchTools(): Record<string, AgentTool> {
  return {
    web_search: {
      description: "搜索公开网页并返回结果列表",
      execute: async (input) => {
        const query = ensureString(input.query, "web_search.query");
        const response = await searxngSearchService.search(query, {
          language:
            typeof input.language === "string" && input.language.trim()
              ? input.language.trim()
              : undefined,
          limit:
            typeof input.limit === "number" && Number.isFinite(input.limit)
              ? Math.trunc(input.limit)
              : undefined,
          safesearch:
            input.safesearch === 0 || input.safesearch === 2 ? input.safesearch : 1,
        });

        if (!response.success) {
          return ok(
            `网络搜索失败：${response.error ?? "没有可用的搜索实例"}`,
            response,
          );
        }

        return ok(
          formatSearchSummary(query, response.totalCount, response.instance),
          response,
        );
      },
    },
  };
}
