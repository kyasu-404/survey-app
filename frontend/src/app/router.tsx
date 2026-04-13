import { Navigate, createBrowserRouter, useParams } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage/DashboardPage";
import FormResponsesHtmlPage from "../pages/FormResponsesHtmlPage/FormResponsesHtmlPage";
import FormResponsesPage from "../pages/FormResponsesPage/FormResponsesPage";
import SurveyPage from "../pages/SurveyPage/SurveyPage";
import BuilderPage from "../pages/BuilderPage/BuilderPage";
import LoginPage from "../pages/LoginPage/LoginPage";
import TemplatesPage from "../pages/TemplatesPage/TemplatesPage";
import UsersPage from "../pages/UsersPage/UsersPage";
import { routes } from "./routes";
import { AppLayout } from "./layout/AppLayout";
import { ProtectedRoute } from "./router/ProtectedRoute";
import { AdminRoute } from "./router/AdminRoute";

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
      {
        path: routes.templates,
        element: (
          <ProtectedRoute>
            <TemplatesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: routes.formResponsesById,
        element: (
          <ProtectedRoute>
            <FormResponsesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: routes.formResponsesHtmlById,
        element: (
          <ProtectedRoute>
            <FormResponsesHtmlPage />
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
      {
        path: routes.builderById,
        element: (
          <ProtectedRoute>
            <BuilderPage />
          </ProtectedRoute>
        ),
      },
      {
        path: routes.users,
        element: (
          <ProtectedRoute>
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          </ProtectedRoute>
        ),
      },
      { path: routes.login, element: <LoginPage /> },
      { path: "*", element: <Navigate to={routes.dashboardMy} replace /> },
    ],
  },
]);
