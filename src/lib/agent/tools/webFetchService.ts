import { forwardProviderRequestViaTauri } from "../providerApi";
import { CLIENT_REQUEST_TIMEOUT_MS } from "./webSearchConstants";
import type { WebFetchResponse } from "./webSearchTypes";

const DEFAULT_MAX_CHARS = 8_000;
const MAX_ALLOWED_CHARS = 20_000;
const EXCERPT_CHARS = 280;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }

  return {
    text: `${normalized.slice(0, maxChars).trimEnd()}…`,
    truncated: true,
  };
}

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

function removeNoiseNodes(root: ParentNode) {
  root
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "svg",
        "canvas",
        "form",
        "button",
        "input",
        "select",
        "textarea",
        "nav",
        "footer",
        "header",
        "aside",
        "iframe",
        "[aria-hidden='true']",
        ".advertisement",
        ".ads",
        ".sidebar",
      ].join(","),
    )
    .forEach((node) => node.remove());
}

function chooseContentRoot(document: Document) {
  const candidates = [
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector("[role='main']"),
    document.querySelector(".article"),
    document.querySelector(".article-content"),
    document.querySelector(".content"),
    document.body,
  ];

  return candidates.find((candidate): candidate is HTMLElement => Boolean(candidate))
    ?? document.body;
}

function collectContentBlocks(root: HTMLElement) {
  const blocks = Array.from(
    root.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre"),
  )
    .map((node) => normalizeWhitespace(node.textContent ?? ""))
    .filter((text) => text.length >= 20);

  if (blocks.length > 0) {
    return blocks;
  }

  const fallback = normalizeWhitespace(root.textContent ?? "");
  return fallback ? [fallback] : [];
}

function extractWebPageContent(html: string, maxChars: number) {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  removeNoiseNodes(document);

  const title =
    normalizeWhitespace(
      document.querySelector("meta[property='og:title']")?.getAttribute("content")
        ?? document.title,
    )
    || "未命名网页";
  const root = chooseContentRoot(document);
  const contentBlocks = collectContentBlocks(root);
  const fullContent = contentBlocks.join("\n\n").trim();
  const truncated = truncateText(fullContent, maxChars);
  const excerpt = truncateText(fullContent, EXCERPT_CHARS).text;

  return {
    content: truncated.text,
    excerpt,
    textLength: fullContent.length,
    title,
    truncated: truncated.truncated,
  };
}

class WebFetchService {
  async fetch(url: string, maxChars?: number): Promise<WebFetchResponse> {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      return {
        success: false,
        url,
        title: "",
        content: "",
        excerpt: "",
        textLength: 0,
        truncated: false,
        provider: "direct_html",
        error: "URL 不能为空",
      };
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
        return {
          success: false,
          url: normalizedUrl,
          title: "",
          content: "",
          excerpt: "",
          textLength: 0,
          truncated: false,
          provider: "direct_html",
          error: `HTTP ${response.status}`,
        };
      }

      const extracted = extractWebPageContent(response.body, safeMaxChars);
      if (!extracted.content) {
        return {
          success: false,
          url: normalizedUrl,
          title: extracted.title,
          content: "",
          excerpt: "",
          textLength: 0,
          truncated: false,
          provider: "direct_html",
          error: "网页正文提取失败或内容为空",
        };
      }

      return {
        success: true,
        url: normalizedUrl,
        title: extracted.title,
        content: extracted.content,
        excerpt: extracted.excerpt,
        textLength: extracted.textLength,
        truncated: extracted.truncated,
        provider: "direct_html",
      };
    } catch (error) {
      return {
        success: false,
        url: normalizedUrl,
        title: "",
        content: "",
        excerpt: "",
        textLength: 0,
        truncated: false,
        provider: "direct_html",
        error: error instanceof Error ? error.message : "网页读取失败",
      };
    }
  }
}

export const webFetchService = new WebFetchService();
