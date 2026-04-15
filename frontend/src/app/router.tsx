import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, createBrowserRouter, useParams } from "react-router-dom";
import { routes } from "./routes";
import { AppLayout } from "./layout/AppLayout";
import { ProtectedRoute } from "./router/ProtectedRoute";
import { AdminRoute } from "./router/AdminRoute";

const DashboardPage = lazy(() => import("../pages/DashboardPage/DashboardPage"));
const FormResponsesHtmlPage = lazy(() => import("../pages/FormResponsesHtmlPage/FormResponsesHtmlPage"));
const FormResponsesPage = lazy(() => import("../pages/FormResponsesPage/FormResponsesPage"));
const SurveyPage = lazy(() => import("../pages/SurveyPage/SurveyPage"));
const BuilderPage = lazy(() => import("../pages/BuilderPage/BuilderPage"));
const LoginPage = lazy(() => import("../pages/LoginPage/LoginPage"));
const TemplatesPage = lazy(() => import("../pages/TemplatesPage/TemplatesPage"));
const UsersPage = lazy(() => import("../pages/UsersPage/UsersPage"));

function withSuspense(element: ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>;
}

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
            {withSuspense(<DashboardPage viewMode="mine" />)}
          </ProtectedRoute>
        ),
      },
      {
        path: routes.dashboardAll,
        element: (
          <ProtectedRoute>
            {withSuspense(<DashboardPage viewMode="all" />)}
          </ProtectedRoute>
        ),
      },
      {
        path: routes.templates,
        element: (
          <ProtectedRoute>
            {withSuspense(<TemplatesPage />)}
          </ProtectedRoute>
        ),
      },
      {
        path: routes.formResponsesById,
        element: (
          <ProtectedRoute>
            {withSuspense(<FormResponsesPage />)}
          </ProtectedRoute>
        ),
      },
      {
        path: routes.formResponsesHtmlById,
        element: (
          <ProtectedRoute>
            {withSuspense(<FormResponsesHtmlPage />)}
          </ProtectedRoute>
        ),
      },
      { path: routes.surveyById, element: withSuspense(<SurveyPage />) },
      { path: routes.legacySurveyById, element: <LegacySurveyRedirect /> },
      {
        path: routes.builder,
        element: (
          <ProtectedRoute>
            {withSuspense(<BuilderPage />)}
          </ProtectedRoute>
        ),
      },
      {
        path: routes.builderById,
        element: (
          <ProtectedRoute>
            {withSuspense(<BuilderPage />)}
          </ProtectedRoute>
        ),
      },
      {
        path: routes.users,
        element: (
          <ProtectedRoute>
            <AdminRoute>
              {withSuspense(<UsersPage />)}
            </AdminRoute>
          </ProtectedRoute>
        ),
      },
      { path: routes.login, element: withSuspense(<LoginPage />) },
      { path: "*", element: <Navigate to={routes.dashboardMy} replace /> },
    ],
  },
]);
