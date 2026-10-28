import { Navigate, Outlet, createBrowserRouter, useParams } from "react-router-dom";
import { routes } from "./routes";
import { ProtectedRoute } from "./router/ProtectedRoute";
import { AdminRoute } from "./router/AdminRoute";

function PublicLayout() {
  return <div className="app-shell app-shell-login app-shell-monochrome">
    <main className="app-main app-main-login app-main-public"><Outlet /></main>
  </div>;
}

async function loadDashboardRoute(viewMode: "mine" | "all") {
  const { default: DashboardPage } = await import("../pages/DashboardPage/DashboardPage");
  return { Component: function DashboardRoute() { return <ProtectedRoute><DashboardPage viewMode={viewMode} /></ProtectedRoute>; } };
}

function LegacySurveyRedirect() {
  const { id } = useParams();
  if (!id) {
    return <Navigate to={routes.dashboardMy} replace />;
  }

  return <Navigate to={routes.survey(id)} replace />;
}

async function loadOfficeEditorRoute() {
  const { default: OfficeEditorPage } = await import("../pages/OfficeEditorPage/OfficeEditorPage");
  return { Component: function OfficeEditorRoute() { return <ProtectedRoute><OfficeEditorPage /></ProtectedRoute>; } };
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

async function loadFormResponsesRoute() {
  const { default: FormResponsesPage } = await import("../pages/FormResponsesPage/FormResponsesPage");

  return {
    Component: function FormResponsesRoute() {
      return (
        <ProtectedRoute>
          <FormResponsesPage />
        </ProtectedRoute>
      );
    },
  };
}

async function loadSurveyRoute() {
  const { default: SurveyPage } = await import("../pages/SurveyPage/SurveyPage");

  return {
    Component: SurveyPage,
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

async function loadOrganizationsRoute() {
  const { default: OrganizationsPage } = await import("../pages/OrganizationsPage/OrganizationsPage");

  return {
    Component: function OrganizationsRoute() {
      return (
        <ProtectedRoute>
          <OrganizationsPage />
        </ProtectedRoute>
      );
    },
  };
}

async function loadSettingsRoute() {
  const { default: SettingsPage } = await import("../pages/SettingsPage/SettingsPage");

  return {
    Component: function SettingsRoute() {
      return (
        <ProtectedRoute>
          <AdminRoute>
            <SettingsPage />
          </AdminRoute>
        </ProtectedRoute>
      );
    },
  };
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: routes.surveyById, lazy: loadSurveyRoute },
      { path: routes.legacySurveyById, element: <LegacySurveyRedirect /> },
      { path: routes.login, lazy: async () => ({ Component: (await import("../pages/LoginPage/LoginPage")).default }) },
    ],
  },
  {
    lazy: async () => ({ Component: (await import("./layout/AppLayout")).AppLayout }),
    children: [
      {
        path: routes.home,
        element: <Navigate to={routes.dashboardMy} replace />,
      },
      {
        path: routes.dashboardMy,
        lazy: () => loadDashboardRoute("mine"),
      },
      {
        path: routes.dashboardAll,
        lazy: () => loadDashboardRoute("all"),
      },
      {
        path: routes.templates,
        lazy: loadTemplatesRoute,
      },
      {
        path: routes.organizations,
        lazy: loadOrganizationsRoute,
      },
      {
        path: routes.formResponsesById,
        lazy: loadFormResponsesRoute,
      },
      {
        path: routes.formResponsesHtmlById,
        lazy: loadFormResponsesHtmlRoute,
      },
      { path: "/forms/:formId/documents/:documentId", lazy: loadOfficeEditorRoute },
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
      {
        path: routes.settings,
        lazy: loadSettingsRoute,
      },
      { path: "*", element: <Navigate to={routes.dashboardMy} replace /> },
    ],
  },
]);
