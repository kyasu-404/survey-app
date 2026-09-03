import ReactDOM from 'react-dom/client'
import type { PropsWithChildren } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider, useAuth } from './app/providers/AuthProvider'
import { QueryProvider } from './app/providers/QueryProvider'
import { ToastProvider } from './app/providers/ToastProvider'
import { AppErrorBoundary } from './app/providers/AppErrorBoundary'
import { initializeObservability } from './shared/lib/observability'
import { ThemeProvider } from './shared/theme/ThemeProvider'
import './app.css'

initializeObservability();

function ThemeAfterAuthentication({ children }: PropsWithChildren) {
  const { user } = useAuth();

  return <ThemeProvider isThemeApplied={Boolean(user)}>{children}</ThemeProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <QueryProvider>
      <AuthProvider>
        <ThemeAfterAuthentication>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </ThemeAfterAuthentication>
      </AuthProvider>
    </QueryProvider>
  </AppErrorBoundary>
);
