import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PlaceholderPage } from '@/features/PlaceholderPage'
import { LoginPage, SetupPage } from '@/features/auth/AuthPages'
import { useAuth } from '@/stores/auth'
import { useGrill } from '@/stores/grill'
import { LocalSource } from '@/lib/source/LocalSource'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense } from 'react'

const GraphPage = lazy(() => import('@/features/graph/GraphPage').then((m) => ({ default: m.GraphPage })))

function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}

/** Decides between setup / login / app, and attaches the data source once authenticated. */
function AuthGate() {
  const { checking, setupRequired, token, authDisabled, role } = useAuth()
  const attach = useGrill((s) => s.attach)
  const source = useGrill((s) => s.source)
  const location = useLocation()
  const authed = !!role && (!!token || authDisabled)

  useEffect(() => {
    if (authed && !source) {
      const src = new LocalSource(() => useAuth.getState().token)
      attach(src).catch(() => {
        /* status store already reflects failure */
      })
    }
  }, [authed, source, attach])

  if (checking) return <FullScreenSpinner />
  if (setupRequired) return <Navigate to="/setup" replace state={{ from: location }} />
  if (!authed) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/graph', element: <Suspense fallback={<FullScreenSpinner />}><GraphPage /></Suspense> },
          { path: '/cooks', element: <PlaceholderPage title="Cooks" /> },
          { path: '/settings/*', element: <PlaceholderPage title="Settings" /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])

export function AppRouter() {
  const bootstrap = useAuth((s) => s.bootstrap)
  useEffect(() => {
    bootstrap()
  }, [bootstrap])
  return <RouterProvider router={router} />
}
