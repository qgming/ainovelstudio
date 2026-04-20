import { forwardProviderRequestViaTauri } from "../providerApi";
import { CLIENT_REQUEST_TIMEOUT_MS } from "./webSearchConstants";
import type { WebFetchResponse } from "./webSearchTypes";
import {
  extractWebPageContent,
  type WebFetchExtractOptions,
} from "./webFetchExtraction";

const DEFAULT_MAX_CHARS = 8_000;
const MAX_ALLOWED_CHARS = 20_000;

function buildRequestHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml",
    "Cache-Control": "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
}

async function withTimeout<T>(task: () => Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    task()
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function createFailureResponse(
  url: string,
  error: string,
  title = "",
): WebFetchResponse {
  return {
    success: false,
    url,
    title,
    content: "",
    error,
    excerpt: "",
    provider: "direct_html",
    textLength: 0,
    truncated: false,
  };
}

class WebFetchService {
  async fetch(
    url: string,
    maxChars?: number,
    options?: WebFetchExtractOptions,
  ): Promise<WebFetchResponse> {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      return createFailureResponse(url, "URL 不能为空");
    }

    const safeMaxChars = Math.min(
      Math.max(maxChars ?? DEFAULT_MAX_CHARS, 500),
      MAX_ALLOWED_CHARS,
    );

    try {
      const response = await withTimeout(
        () =>
          forwardProviderRequestViaTauri({
            headers: buildRequestHeaders(),
            method: "GET",
            url: normalizedUrl,
          }),
        CLIENT_REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        return createFailureResponse(normalizedUrl, `HTTP ${response.status}`);
      }

      const extracted = extractWebPageContent(
        response.body,
        safeMaxChars,
        normalizedUrl,
        options,
      );
      if (!extracted.content) {
        return createFailureResponse(
          normalizedUrl,
          "网页正文提取失败或内容为空",
          extracted.title,
        );
      }

      return {
        success: true,
        url: normalizedUrl,
        title: extracted.title,
        content: extracted.content,
        excerpt: extracted.excerpt,
        links: extracted.links,
        mode: extracted.mode,
        provider: "direct_html",
        selectedBlockCount: extracted.selectedBlockCount,
        selectedBlockEnd: extracted.selectedBlockEnd,
        selectedBlockStart: extracted.selectedBlockStart,
        tables: extracted.tables,
        textLength: extracted.textLength,
        truncated: extracted.truncated,
      };
    } catch (error) {
      return createFailureResponse(
        normalizedUrl,
        error instanceof Error ? error.message : "网页读取失败",
      );
    }
  }
}

export const webFetchService = new WebFetchService();
