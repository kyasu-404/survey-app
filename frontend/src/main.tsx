import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider } from './app/providers/AuthProvider'
import { QueryProvider } from './app/providers/QueryProvider'
import { ToastProvider } from './app/providers/ToastProvider'
import { AppErrorBoundary } from './app/providers/AppErrorBoundary'
import { initializeObservability } from './shared/lib/observability'
import './app.css'

initializeObservability();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  </AppErrorBoundary>
);
