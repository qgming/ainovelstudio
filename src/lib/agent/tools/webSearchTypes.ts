export type FailureCode =
  | "rate_limited"
  | "format_blocked"
  | "anti_bot"
  | "timeout"
  | "network"
  | "invalid_json"
  | "http_error"
  | "unknown";

export type WebSearchResult = {
  url: string;
  title: string;
  snippet: string;
  source: string;
};

export type WebFetchResponse = {
  success: boolean;
  url: string;
  title: string;
  content: string;
  excerpt: string;
  textLength: number;
  truncated: boolean;
  provider: "direct_html";
  error?: string;
};

export type SearchFailure = {
  instance: string;
  stage: "get_root";
  method: "GET";
  endpoint: "/search";
  code: FailureCode;
  status?: number;
  message: string;
};

export type WebSearchResponse = {
  success: boolean;
  query: string;
  provider: "searxng";
  instance: string;
  totalCount: number;
  results: WebSearchResult[];
  error?: string;
  errorSummary?: {
    totalAttempts: number;
    failures: SearchFailure[];
  };
};

export type SearxngInstanceState = {
  baseUrl: string;
  failureCount: number;
  cooldownUntil: number;
  successCount: number;
  lastCheckedAt: number;
  lastErrorCode?: FailureCode;
  lastErrorMessage?: string;
};
