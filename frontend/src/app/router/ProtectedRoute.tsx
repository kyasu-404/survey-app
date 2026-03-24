import { Navigate, useLocation } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { useAuth } from "../providers/AuthProvider";
import { routes } from "../routes";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p>Проверка авторизации...</p>;
  }

  if (!user) {
    return <Navigate to={routes.login} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

