import { Navigate, useNavigate, useParams } from "react-router-dom";
import { buildBookWorkspaceRoute } from "../lib/bookWorkspace/routes";
import { BookPage } from "./BookPage";

export function BookWorkspacePage() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();

  if (!bookId) {
    return <Navigate replace to="/" />;
  }

  return (
    <BookPage
      onNavigateHome={() => navigate("/")}
      requestedBookId={bookId}
      onWorkspaceBookChange={(bookId) => {
        navigate(buildBookWorkspaceRoute(bookId), { replace: true });
      }}
    />
  );
}
