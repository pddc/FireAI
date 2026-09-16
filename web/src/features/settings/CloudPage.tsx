import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudOff, Loader2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { get, post, api } from '@/lib/api'
import { useGrill } from '@/stores/grill'
import { fmtClock } from '@/lib/format'
import { useNow } from '@/hooks/useNow'

interface CloudStatus {
  paired: boolean
  grill_id: string | null
  project_id: string | null
  paired_at: number | null
  enabled: boolean
  control_enabled: boolean
  monitor_enabled: boolean
  pairing: { status: string; code: string | null; expires_at: number; error: string | null; grill_id: string | null } | null
}

/** Local-mode page: pair this grill with the FireAI cloud and choose what it may do. */
export function CloudPage() {
  const qc = useQueryClient()
  const source = useGrill((s) => s.source)
  const now = useNow(1000)
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  const status = useQuery({
    queryKey: ['cloud-status'],
    queryFn: () => get<CloudStatus>('/api/v1/cloud/status'),
    refetchInterval: (q) => (q.state.data?.pairing?.status === 'pending' ? 3000 : false),
  })
  const start = useMutation({
    mutationFn: () => post<CloudStatus['pairing']>('/api/v1/cloud/pair'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-status'] }),
    onError: (e) => toast.error((e as Error).message),
  })
  const cancel = useMutation({
    mutationFn: () => api('/api/v1/cloud/pair', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-status'] }),
  })
  const unpair = useMutation({
    mutationFn: () => post('/api/v1/cloud/unpair'),
    onSuccess: () => {
      setConfirmUnpair(false)
      toast.success('Unpaired')
      qc.invalidateQueries({ queryKey: ['cloud-status'] })
    },
  })
  const setFlag = useMutation({
    mutationFn: (patch: Record<string, boolean>) => source!.patchSettings({ cloud: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-status'] }),
    onError: (e) => toast.error((e as Error).message),
  })

  useEffect(() => {
    if (status.data?.pairing?.status === 'paired') {
      toast.success('Paired with the cloud')
      qc.invalidateQueries({ queryKey: ['cloud-status'] })
    }
  }, [status.data?.pairing?.status, qc])

  const d = status.data
  const pairing = d?.pairing
  const remaining = pairing?.expires_at ? pairing.expires_at - now : 0

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Cloud</h1>
      {!d ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : d.paired ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Cloud className="size-4 text-ember" /> Connected
              </CardTitle>
              <CardDescription>
                Grill ID <span className="font-mono">{d.grill_id}</span> · project {d.project_id}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Live monitoring</Label>
                  <p className="text-xs text-muted-foreground">Mirror temperatures, status and cook history to the cloud.</p>
                </div>
                <Switch checked={d.monitor_enabled} onCheckedChange={(c) => setFlag.mutate({ monitor_enabled: c })} />
              </label>
              <label className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Remote control</Label>
                  <p className="text-xs text-muted-foreground">Allow members of this grill to change modes and setpoints from the app. Off by default.</p>
                </div>
                <Switch checked={d.control_enabled} onCheckedChange={(c) => setFlag.mutate({ control_enabled: c })} />
              </label>
              <Button variant="outline" onClick={() => setConfirmUnpair(true)}>
                <Unplug className="size-4" /> Unpair
              </Button>
            </CardContent>
          </Card>
          <Dialog open={confirmUnpair} onOpenChange={setConfirmUnpair}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Unpair this grill?</DialogTitle>
                <DialogDescription>The cloud credentials on this device are deleted and the grill goes offline in the app. You can pair again at any time.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmUnpair(false)}>Cancel</Button>
                <Button variant="destructive" onClick={() => unpair.mutate()} disabled={unpair.isPending}>Unpair</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : pairing?.status === 'pending' && pairing.code ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enter this code in the FireAI app</CardTitle>
            <CardDescription>Open the app, sign in, choose “Pair a grill” and type the code. Expires in {fmtClock(Math.max(0, remaining))}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted py-6 text-center font-mono text-5xl tracking-[0.35em] tabular">
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Waiting for the app…
            </div>
            <Button variant="ghost" onClick={() => cancel.mutate()}>Cancel</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CloudOff className="size-4" /> Not connected
            </CardTitle>
            <CardDescription>Pair this grill with your FireAI account to watch it from anywhere and get push notifications. Everything keeps working locally without it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pairing?.status === 'error' && <p className="text-sm text-destructive">{pairing.error}</p>}
            {pairing?.status === 'expired' && <p className="text-sm text-muted-foreground">The last code expired. Start again.</p>}
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending && <Loader2 className="size-4 animate-spin" />} Pair with the cloud
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
