import { Navigate, createBrowserRouter, useParams } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage/DashboardPage";
import SurveyPage from "../pages/SurveyPage/SurveyPage";
import BuilderPage from "../pages/BuilderPage/BuilderPage";
import LoginPage from "../pages/LoginPage/LoginPage";
import { routes } from "./routes";
import { AppLayout } from "./layout/AppLayout";
import { ProtectedRoute } from "./router/ProtectedRoute";

function LegacySurveyRedirect() {
  const { id } = useParams();
  if (!id) {
    return <Navigate to={routes.dashboardMy} replace />;
  }

  return <Navigate to={routes.survey(id)} replace />;
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: routes.home,
        element: <Navigate to={routes.dashboardMy} replace />,
      },
      {
        path: routes.dashboardMy,
        element: (
          <ProtectedRoute>
            <DashboardPage viewMode="mine" />
          </ProtectedRoute>
        ),
      },
      {
        path: routes.dashboardAll,
        element: (
          <ProtectedRoute>
            <DashboardPage viewMode="all" />
          </ProtectedRoute>
        ),
      },
      { path: routes.surveyById, element: <SurveyPage /> },
      { path: routes.legacySurveyById, element: <LegacySurveyRedirect /> },
      {
        path: routes.builder,
        element: (
          <ProtectedRoute>
            <BuilderPage />
          </ProtectedRoute>
        ),
      },
      { path: routes.login, element: <LoginPage /> },
      { path: "*", element: <Navigate to={routes.dashboardMy} replace /> },
    ],
  },
]);
