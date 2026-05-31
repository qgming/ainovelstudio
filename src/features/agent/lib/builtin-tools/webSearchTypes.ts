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

export type WebFetchLink = {
  text: string;
  url: string;
};

export type WebFetchTable = {
  caption?: string;
  headers: string[];
  rows: string[][];
};

export type WebFetchResponse = {
  success: boolean;
  url: string;
  title: string;
  content: string;
  excerpt: string;
  links?: WebFetchLink[];
  textLength: number;
  tables?: WebFetchTable[];
  truncated: boolean;
  mode?: "anchor_range" | "full" | "heading_range";
  provider: "direct_html";
  selectedBlockCount?: number;
  selectedBlockEnd?: number;
  selectedBlockStart?: number;
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
