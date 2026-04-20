import type { WebFetchLink, WebFetchTable } from "./webSearchTypes";

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function resolveLinkUrl(href: string, pageUrl: string) {
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function extractLinks(root: HTMLElement, pageUrl: string) {
  const seen = new Set<string>();
  return Array.from(root.querySelectorAll("a[href]")).flatMap(
    (node): WebFetchLink[] => {
      const href = node.getAttribute("href")?.trim();
      const url = href ? resolveLinkUrl(href, pageUrl) : null;
      if (!url || seen.has(url)) {
        return [];
      }
      seen.add(url);
      return [{ text: normalizeWhitespace(node.textContent ?? "") || url, url }];
    },
  );
}

function extractRowCells(row: Element) {
  return Array.from(row.querySelectorAll("th, td"))
    .map((cell) => normalizeWhitespace(cell.textContent ?? ""))
    .filter(Boolean);
}

export function extractTables(root: HTMLElement) {
  return Array.from(root.querySelectorAll("table")).flatMap(
    (table): WebFetchTable[] => {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length === 0) {
        return [];
      }

      const headerRow =
        table.querySelector("thead tr")
        ?? rows.find((row) => row.querySelector("th"))
        ?? null;
      const headers = headerRow ? extractRowCells(headerRow) : [];
      const dataRows = rows
        .filter((row) => row !== headerRow)
        .map(extractRowCells)
        .filter((cells) => cells.length > 0);
      const caption = normalizeWhitespace(
        table.querySelector("caption")?.textContent ?? "",
      );

      return headers.length > 0 || dataRows.length > 0
        ? [{ caption: caption || undefined, headers, rows: dataRows }]
        : [];
    },
  );
}
