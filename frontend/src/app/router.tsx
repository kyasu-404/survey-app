import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage/DashboardPage";
import SurveyPage from "../pages/SurveyPage/SurveyPage";
import BuilderPage from "../pages/BuilderPage/BuilderPage";
import LoginPage from "../pages/LoginPage/LoginPage";
import { routes } from "./routes";
import { AppLayout } from "./layout/AppLayout";
import { createBrowserRouter } from 'react-router-dom'

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path={routes.home} element={<DashboardPage />} />
        <Route path={routes.surveyById} element={<SurveyPage />} />
        <Route path={routes.builder} element={<BuilderPage />} />
        <Route path={routes.login} element={<LoginPage />} />
      </Route>
      <Route path="*" element={<Navigate to={routes.home} replace />} />
    </Routes>
  );
}

import { SurveyPage } from '@/pages/survey-page/ui/SurveyPage'

export const router = createBrowserRouter([
  {
    path: '/survey/:id',
    element: <SurveyPage />,
  },
])
