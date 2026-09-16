import { AlertTriangle, WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useConnection, useGrill, useGrillState } from '@/stores/grill'
import { ProbeCard } from './ProbeCard'
import { ModeControls } from './ModeControls'
import { StatusStrip } from './StatusStrip'
import { ManualPanel } from './ManualPanel'

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const state = useGrillState()
  const status = useConnection()
  const lastError = useGrill((s) => s.lastError)
  const staleSince = useGrill((s) => s.staleSince)

  if (!state) {
    return status === 'offline' ? (
      <Alert variant="destructive">
        <WifiOff className="size-4" />
        <AlertTitle>Can't reach the grill</AlertTitle>
        <AlertDescription>{lastError ?? 'The controller is not responding. Check that FireAI is running.'}</AlertDescription>
      </Alert>
    ) : (
      <DashboardSkeleton />
    )
  }

  const primary = state.probes.filter((p) => p.type === 'Primary' && p.enabled)
  const food = state.probes.filter((p) => p.type === 'Food' && p.enabled)

  return (
    <div className="space-y-4">
      {state.critical_error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Critical error</AlertTitle>
          <AlertDescription>The control process reported a critical error. Check the events log and hardware configuration.</AlertDescription>
        </Alert>
      )}
      {state.errors.map((e, i) => (
        <Alert key={i} variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{e}</AlertDescription>
        </Alert>
      ))}
      {(status === 'offline' || staleSince) && (
        <Alert>
          <WifiOff className="size-4" />
          <AlertTitle>{status === 'offline' ? 'Grill offline' : 'Connecting…'}</AlertTitle>
          <AlertDescription>
            Showing the last known state{staleSince ? ` from ${new Date(staleSince).toLocaleString()}` : ''}. Controls are disabled until the grill is reachable.
          </AlertDescription>
        </Alert>
      )}

      <ModeControls state={state} />
      <StatusStrip state={state} />
      {state.mode === 'Manual' && <ManualPanel state={state} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {primary.map((p) => (
          <ProbeCard key={p.label} state={state} probe={p} size="lg" />
        ))}
        {food.map((p) => (
          <ProbeCard key={p.label} state={state} probe={p} />
        ))}
      </div>
    </div>
  )
}
