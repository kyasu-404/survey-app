import { Navigate, createBrowserRouter, useParams } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage/DashboardPage";
import FormResponsesPage from "../pages/FormResponsesPage/FormResponsesPage";
import SurveyPage from "../pages/SurveyPage/SurveyPage";
import LoginPage from "../pages/LoginPage/LoginPage";
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

async function loadTemplatesRoute() {
  const { default: TemplatesPage } = await import("../pages/TemplatesPage/TemplatesPage");

  return {
    Component: function TemplatesRoute() {
      return (
        <ProtectedRoute>
          <TemplatesPage />
        </ProtectedRoute>
      );
    },
  };
}

async function loadFormResponsesHtmlRoute() {
  const { default: FormResponsesHtmlPage } = await import("../pages/FormResponsesHtmlPage/FormResponsesHtmlPage");

  return {
    Component: function FormResponsesHtmlRoute() {
      return (
        <ProtectedRoute>
          <FormResponsesHtmlPage />
        </ProtectedRoute>
      );
    },
  };
}

async function loadBuilderRoute() {
  const { default: BuilderPage } = await import("../pages/BuilderPage/BuilderPage");

  return {
    Component: function BuilderRoute() {
      return (
        <ProtectedRoute>
          <BuilderPage />
        </ProtectedRoute>
      );
    },
  };
}

async function loadUsersRoute() {
  const { default: UsersPage } = await import("../pages/UsersPage/UsersPage");

  return {
    Component: function UsersRoute() {
      return (
        <ProtectedRoute>
          <AdminRoute>
            <UsersPage />
          </AdminRoute>
        </ProtectedRoute>
      );
    },
  };
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
        lazy: loadTemplatesRoute,
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
        lazy: loadFormResponsesHtmlRoute,
      },
      { path: routes.surveyById, element: <SurveyPage /> },
      { path: routes.legacySurveyById, element: <LegacySurveyRedirect /> },
      {
        path: routes.builder,
        lazy: loadBuilderRoute,
      },
      {
        path: routes.builderById,
        lazy: loadBuilderRoute,
      },
      {
        path: routes.users,
        lazy: loadUsersRoute,
      },
      { path: routes.login, element: <LoginPage /> },
      { path: "*", element: <Navigate to={routes.dashboardMy} replace /> },
    ],
  },
]);
