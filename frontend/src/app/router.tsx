import { Navigate, createBrowserRouter } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage/DashboardPage";
import SurveyPage from "../pages/SurveyPage/SurveyPage";
import BuilderPage from "../pages/BuilderPage/BuilderPage";
import LoginPage from "../pages/LoginPage/LoginPage";
import { routes } from "./routes";
import { AppLayout } from "./layout/AppLayout";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: routes.home, element: <DashboardPage /> },
      { path: routes.surveyById, element: <SurveyPage /> },
      { path: routes.builder, element: <BuilderPage /> },
      { path: routes.login, element: <LoginPage /> },
      { path: "*", element: <Navigate to={routes.home} replace /> },
    ],
  },
]);
