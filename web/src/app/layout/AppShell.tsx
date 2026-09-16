import { Link, NavLink, Outlet } from 'react-router-dom'
import { IS_CLOUD } from '@/lib/mode'
import { Flame, LineChart, BookOpen, Settings2, Wifi, WifiOff, Loader2, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConnection, useGrillState } from '@/stores/grill'
import { useUi } from '@/stores/ui'
import { MODE_LABEL } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { TimerPill } from '@/features/dashboard/TimerPill'

// Relative links: the shell is mounted at "/" in local mode and at "/g/:grillId" in cloud mode.
const NAV = [
  { to: '.', label: 'Dashboard', icon: Flame, end: true },
  { to: 'graph', label: 'Graph', icon: LineChart },
  { to: 'cooks', label: 'Cooks', icon: BookOpen },
  { to: 'settings', label: 'Settings', icon: Settings2 },
]

function ConnectionDot() {
  const status = useConnection()
  const cls = status === 'live' ? 'text-ok' : status === 'offline' ? 'text-destructive' : 'text-muted-foreground'
  const Icon = status === 'live' ? Wifi : status === 'offline' ? WifiOff : Loader2
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', cls)} title={status}>
      <Icon className={cn('size-4', status === 'connecting' && 'animate-spin')} />
      <span className="hidden sm:inline capitalize">{status}</span>
    </span>
  )
}

function ModeBadge() {
  const state = useGrillState()
  if (!state) return null
  const active = !['Stop', 'Error', 'Monitor'].includes(state.mode)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        state.mode === 'Error' ? 'bg-destructive/15 text-destructive' : active ? 'bg-ember-soft text-ember' : 'bg-muted text-muted-foreground',
      )}
    >
      {active && <span className="size-1.5 rounded-full bg-ember animate-pulse" />}
      {MODE_LABEL[state.mode] ?? state.mode}
    </span>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useUi()
  const dark = document.documentElement.classList.contains('dark')
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {theme === 'dark' || dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

export function AppShell() {
  const state = useGrillState()
  return (
    <div className="flex h-full min-h-dvh flex-col lg:flex-row bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 gap-2">
        <div className="flex items-center gap-2 px-2 py-3">
          <Flame className="size-6 text-ember" />
          <span className="text-lg font-semibold tracking-tight">FireAI</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between px-2 text-xs text-muted-foreground">
          <ConnectionDot />
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur pt-safe">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <div className="flex items-center gap-2 lg:hidden">
              <Flame className="size-5 text-ember" />
            </div>
            <div className="min-w-0 flex-1">
              {IS_CLOUD ? (
                <Link to="/grills" className="block truncate text-sm font-semibold leading-tight hover:underline">{state?.name || 'FireAI'}</Link>
              ) : (
                <div className="truncate text-sm font-semibold leading-tight">{state?.name || 'FireAI'}</div>
              )}
              <div className="flex items-center gap-2">
                <ModeBadge />
              </div>
            </div>
            <TimerPill />
            <div className="lg:hidden flex items-center gap-1">
              <ConnectionDot />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 lg:pb-8">
          <Outlet />
        </main>

        {/* Mobile bottom tabs */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/90 backdrop-blur lg:hidden pb-safe">
          <div className="mx-auto grid max-w-lg grid-cols-4">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                    isActive ? 'text-ember' : 'text-muted-foreground',
                  )
                }
              >
                <Icon className="size-5" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
