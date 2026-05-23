export function buildBookWorkspaceRoute(bookId: string) {
  return `/books/${encodeURIComponent(bookId)}`;
}

export function buildBookRelationsRoute(bookId: string) {
  return `/books/${encodeURIComponent(bookId)}/relations`;
}
