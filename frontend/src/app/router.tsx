import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage/DashboardPage";
import SurveyPage from "../pages/SurveyPage/SurveyPage";
import BuilderPage from "../pages/BuilderPage/BuilderPage";
import LoginPage from "../pages/LoginPage/LoginPage";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/survey/:id" element={<SurveyPage />} />
      <Route path="/builder" element={<BuilderPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
