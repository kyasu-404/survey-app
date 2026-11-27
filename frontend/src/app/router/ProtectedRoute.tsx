import { Navigate, useLocation } from "react-router-dom";
import { Fragment, type PropsWithChildren } from "react";
import { useAuth } from "../providers/AuthProvider";
import { isTerminalSessionError } from "../../shared/api/session";
import { routes } from "../routes";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { user, loading, sessionIssue, previousUserId, retrySession } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p>Проверка авторизации...</p>;
  }

  if (!user) {
    if (sessionIssue && !isTerminalSessionError(sessionIssue)) {
      return <div>
        <p role="alert">{sessionIssue.message}</p>
        <button type="button" className="app-button" onClick={retrySession}>Повторить проверку</button>
      </div>;
    }

    const { pathname, search, hash } = location;
    const state = {
      from: { pathname, search, hash },
      ownerId: previousUserId ?? (sessionIssue ? null : undefined),
      sessionMessage: sessionIssue?.message,
    };
    return <Navigate to={routes.login} replace state={state} />;
  }

  return <Fragment key={user.id}>{children}</Fragment>;
}

