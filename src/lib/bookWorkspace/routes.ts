export function buildBookWorkspaceRoute(bookId: string) {
  return `/books/${encodeURIComponent(bookId)}`;
}
