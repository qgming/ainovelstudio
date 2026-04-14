import { useNavigate, useSearchParams } from "react-router-dom";
import { getWorkspacePathFromSearchParams, buildBookWorkspaceRoute } from "../lib/bookWorkspace/routes";
import { BookPage } from "./BookPage";

export function BookWorkspacePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedRootPath = getWorkspacePathFromSearchParams(searchParams);

  return (
    <BookPage
      requestedRootPath={requestedRootPath}
      onWorkspaceRootChange={(rootPath) => {
        navigate(buildBookWorkspaceRoute(rootPath), { replace: requestedRootPath == null });
      }}
    />
  );
}
