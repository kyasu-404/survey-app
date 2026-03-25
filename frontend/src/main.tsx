import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider } from './app/providers/AuthProvider'
import { QueryProvider } from './app/providers/QueryProvider'
import { ToastProvider } from './app/providers/ToastProvider'
import { AppErrorBoundary } from './app/providers/AppErrorBoundary'
import './app.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>
          <AppErrorBoundary>
            <RouterProvider router={router} />
          </AppErrorBoundary>
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  </React.StrictMode>
);
