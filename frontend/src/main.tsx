import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { surveyLocalization } from "survey-core";
import "survey-core/i18n/russian";
import "survey-creator-core/i18n/russian";
import { router } from './app/router'
import { AuthProvider } from './app/providers/AuthProvider'
import { QueryProvider } from './app/providers/QueryProvider'
import { ToastProvider } from './app/providers/ToastProvider'
import { AppErrorBoundary } from './app/providers/AppErrorBoundary'
import './app.css'

surveyLocalization.defaultLocale = "ru";

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryProvider>
    <AuthProvider>
      <ToastProvider>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  </QueryProvider>
);
