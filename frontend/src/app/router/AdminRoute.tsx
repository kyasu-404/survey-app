import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { routes } from "../routes";

export function AdminRoute({ children }: PropsWithChildren) {
  const { user, loading, profile, profileLoading, profileIssue, refreshProfile } = useAuth();
  const hasCurrentProfile = Boolean(user && profile?.id === user.id);

  // Rechecking the same user's profile must not unmount unsaved admin forms.
  if (loading || (profileLoading && !hasCurrentProfile)) {
    return <p>Проверка прав доступа...</p>;
  }

  if (!hasCurrentProfile && profileIssue) {
    return <div>
      <p role="alert">{profileIssue}</p>
      <button type="button" className="app-button" onClick={() => void refreshProfile()}>Повторить проверку</button>
    </div>;
  }

  if (!hasCurrentProfile || profile?.role !== "admin" || profile.is_disabled) {
    return <Navigate to={routes.dashboardMy} replace />;
  }

  return <>{children}</>;
}
