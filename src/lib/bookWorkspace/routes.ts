const WORKSPACE_PATH_QUERY_KEY = "path";

export function buildBookWorkspaceRoute(rootPath: string) {
  const searchParams = new URLSearchParams({
    [WORKSPACE_PATH_QUERY_KEY]: rootPath,
  });

  return `/books/workspace?${searchParams.toString()}`;
}

export function getWorkspacePathFromSearchParams(searchParams: URLSearchParams) {
  const value = searchParams.get(WORKSPACE_PATH_QUERY_KEY);
  return value && value.trim() ? value : null;
}
