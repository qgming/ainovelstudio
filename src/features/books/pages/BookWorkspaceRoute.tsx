import { Navigate, useNavigate, useParams } from "react-router-dom";
import { buildBookWorkspaceRoute } from "@features/books/lib/routes";
import { BookWorkspaceView } from "./BookWorkspaceView";

export function BookWorkspaceRoute() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();

  if (!bookId) {
    return <Navigate replace to="/" />;
  }

  return (
    <BookWorkspaceView
      onNavigateHome={() => navigate("/")}
      requestedBookId={bookId}
      onWorkspaceBookChange={(bookId) => {
        navigate(buildBookWorkspaceRoute(bookId), { replace: true });
      }}
    />
  );
}
