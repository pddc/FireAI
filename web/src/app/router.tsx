import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, type RouteObject } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { LoginPage, SetupPage } from '@/features/auth/AuthPages'
import { SettingsIndexPage } from '@/features/settings/SettingsIndexPage'
import { SettingsSectionPage } from '@/features/settings/SettingsSectionPage'
import { useAuth } from '@/stores/auth'
import { useGrill } from '@/stores/grill'
import { LocalSource } from '@/lib/source/LocalSource'
import { IS_CLOUD } from '@/lib/mode'

const GraphPage = lazy(() => import('@/features/graph/GraphPage').then((m) => ({ default: m.GraphPage })))
const ProbesPage = lazy(() => import('@/features/settings/ProbesPage').then((m) => ({ default: m.ProbesPage })))
const CooksPage = lazy(() => import('@/features/cooks/CooksPage').then((m) => ({ default: m.CooksPage })))
const CookDetailPage = lazy(() => import('@/features/cooks/CookDetailPage').then((m) => ({ default: m.CookDetailPage })))
const PelletsPage = lazy(() => import('@/features/pellets/PelletsPage').then((m) => ({ default: m.PelletsPage })))
const EventsPage = lazy(() => import('@/features/settings/EventsPage').then((m) => ({ default: m.EventsPage })))
const SystemPage = lazy(() => import('@/features/settings/SystemPage').then((m) => ({ default: m.SystemPage })))
const RecipesPage = lazy(() => import('@/features/recipes/RecipesPage').then((m) => ({ default: m.RecipesPage })))
const HardwarePage = lazy(() => import('@/features/settings/HardwarePage').then((m) => ({ default: m.HardwarePage })))
const TunerPage = lazy(() => import('@/features/settings/TunerPage').then((m) => ({ default: m.TunerPage })))
const MembersPage = lazy(() => import('@/features/cloud/MembersPage').then((m) => ({ default: m.MembersPage })))
const CloudPage = lazy(() => import('@/features/settings/CloudPage').then((m) => ({ default: m.CloudPage })))
const cloudPage = (name: 'SignInPage' | 'GrillsPage' | 'PairPage' | 'CloudGrillGate' | 'CloudAuthGate') =>
  lazy(() => import('@/features/cloud/CloudPages').then((m) => ({ default: m[name] })))
const SignInPage = cloudPage('SignInPage')
const GrillsPage = cloudPage('GrillsPage')
const PairPage = cloudPage('PairPage')
const CloudGrillGate = cloudPage('CloudGrillGate')
const CloudAuthGate = cloudPage('CloudAuthGate')

function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}

const lazyEl = (el: React.ReactNode) => <Suspense fallback={<FullScreenSpinner />}>{el}</Suspense>

/** Local mode: decides between setup / login / app and attaches the LocalSource. */
function LocalAuthGate() {
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

/** Pages shown inside the shell, identical in both modes. */
const shellChildren: RouteObject[] = [
  { index: true, element: <DashboardPage /> },
  { path: 'graph', element: lazyEl(<GraphPage />) },
  { path: 'cooks', element: lazyEl(<CooksPage />) },
  { path: 'cooks/:cookId', element: lazyEl(<CookDetailPage />) },
  { path: 'recipes', element: lazyEl(<RecipesPage />) },
  { path: 'settings', element: <SettingsIndexPage /> },
  { path: 'settings/pellets-manager', element: lazyEl(<PelletsPage />) },
  { path: 'settings/events', element: lazyEl(<EventsPage />) },
  ...(IS_CLOUD ? [{ path: 'settings/members', element: lazyEl(<MembersPage />) }] : [
    { path: 'settings/cloud', element: lazyEl(<CloudPage />) },
    { path: 'settings/probes', element: lazyEl(<ProbesPage />) },
    { path: 'settings/system', element: lazyEl(<SystemPage />) },
    { path: 'settings/hardware', element: lazyEl(<HardwarePage />) },
    { path: 'settings/tuner', element: lazyEl(<TunerPage />) },
  ]),
  { path: 'settings/:section', element: <SettingsSectionPage /> },
]

const DebugWidgets = lazy(() => import('@/features/DebugWidgets').then((m) => ({ default: m.DebugWidgets })))

const localRoutes: RouteObject[] = [
  ...(import.meta.env.DEV ? [{ path: '/debug', element: lazyEl(<DebugWidgets />) }] : []),
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <LocalAuthGate />,
    children: [{ path: '/', element: <AppShell />, children: [...shellChildren, { path: '*', element: <Navigate to="/" replace /> }] }],
  },
]

const cloudRoutes: RouteObject[] = [
  { path: '/signin', element: lazyEl(<SignInPage />) },
  {
    element: lazyEl(<CloudAuthGate />),
    children: [
      { path: '/grills', element: lazyEl(<GrillsPage />) },
      { path: '/grills/pair', element: lazyEl(<PairPage />) },
      {
        path: '/g/:grillId',
        element: lazyEl(<CloudGrillGate />),
        children: [{ element: <AppShell />, children: shellChildren }],
      },
      { path: '*', element: <Navigate to="/grills" replace /> },
    ],
  },
]

const router = createBrowserRouter(IS_CLOUD ? cloudRoutes : localRoutes)

export function AppRouter() {
  const bootstrap = useAuth((s) => s.bootstrap)
  useEffect(() => {
    if (!IS_CLOUD) bootstrap()
  }, [bootstrap])
  return <RouterProvider router={router} />
}
