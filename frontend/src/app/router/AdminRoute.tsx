import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { routes } from "../routes";

export function AdminRoute({ children }: PropsWithChildren) {
  const { loading, profile, profileLoading } = useAuth();

  if (loading || profileLoading) {
    return <p>Проверка прав доступа...</p>;
  }

  if (profile?.role !== "admin") {
    return <Navigate to={routes.dashboardMy} replace />;
  }

  return <>{children}</>;
}
