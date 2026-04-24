export function buildExpansionListRoute() {
  return "/expansions";
}

export function buildExpansionDetailRoute(workspaceId: string) {
  return `/expansions/${encodeURIComponent(workspaceId)}`;
}
