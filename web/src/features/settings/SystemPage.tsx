import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, Power, RefreshCw, RotateCcw, Upload, Cpu, ArrowUpCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { API_BASE, get, post } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useCommand } from '@/hooks/useCommand'
import { useGrillState } from '@/stores/grill'
import { fmtDuration } from '@/lib/format'
import { SettingsSectionInline } from './SettingsSectionInline'
import { ApiKeysCard } from './ApiKeysCard'
import { MaintenanceCard } from './MaintenanceCard'

interface UpdateCheck {
  current: string
  latest: string
  update_available: boolean
  release: { tag: string; name: string; notes: string; published_at: string | null; size: number | null }
}
interface UpdateStatus {
  percent: number
  status: string
  message: string
  error: string | null
}

function UpdateCard({ cooking }: { cooking: boolean }) {
  const check = useQuery({ queryKey: ['update-check'], queryFn: () => get<UpdateCheck>('/api/v1/system/update/check'), retry: false, staleTime: 5 * 60_000 })
  const status = useQuery({
    queryKey: ['update-status'],
    queryFn: () => get<UpdateStatus>('/api/v1/system/update/status'),
    refetchInterval: (q) => (['checking', 'downloading', 'extracting', 'installing'].includes(q.state.data?.status ?? '') ? 2000 : false),
  })
  const apply = useMutation({
    mutationFn: () => post<UpdateStatus>('/api/v1/system/update/apply'),
    onSuccess: () => status.refetch(),
    onError: (e) => toast.error((e as Error).message),
  })
  const running = ['checking', 'downloading', 'extracting', 'installing'].includes(status.data?.status ?? '')
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><ArrowUpCircle className="size-4" /> Software update</CardTitle>
        <CardDescription>
          {check.isLoading && 'Checking for updates…'}
          {check.isError && 'Could not check for updates (offline, or no release repository configured).'}
          {check.data && !check.data.update_available && `You are on ${check.data.current}, the latest release.`}
          {check.data?.update_available && `${check.data.release.name} is available (you have ${check.data.current}).`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {check.data?.update_available && check.data.release.notes && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{check.data.release.notes}</pre>}
        {status.data && status.data.status !== 'idle' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm"><span>{status.data.message}</span><span className="tabular text-muted-foreground">{status.data.percent}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${status.data.status === 'error' ? 'bg-destructive' : 'bg-ember'}`} style={{ width: `${status.data.percent}%` }} /></div>
            {status.data.error && <p className="text-xs text-destructive">{status.data.error}</p>}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => check.refetch()} disabled={check.isFetching}><RefreshCw className="size-4" /> Check again</Button>
          {check.data?.update_available && (
            <Button size="sm" onClick={() => apply.mutate()} disabled={running || cooking || apply.isPending}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpCircle className="size-4" />} Install {check.data.release.tag}
            </Button>
          )}
        </div>
        {cooking && check.data?.update_available && <p className="text-xs text-muted-foreground">Stop the grill before updating.</p>}
      </CardContent>
    </Card>
  )
}

interface SystemInfo {
  version: { server: string; build: number }
  modules: Record<string, string>
  board: string | null
  system: { python?: string; platform?: string; cpu_percent?: number; memory_percent?: number; disk_percent?: number; uptime_s?: number }
}

export function SystemPage() {
  const qc = useQueryClient()
  const token = useAuth((s) => s.token)
  const state = useGrillState()
  const { run } = useCommand()
  const info = useQuery({ queryKey: ['system-info'], queryFn: () => get<SystemInfo>('/api/v1/system/info'), refetchInterval: 15_000 })
  const [confirm, setConfirm] = useState<null | 'restart' | 'reboot' | 'shutdown'>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cooking = state && !['Stop', 'Error', 'Monitor'].includes(state.mode)

  const restore = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_BASE}/api/v1/system/restore`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error((await res.json()).detail?.message ?? 'Restore failed')
      return res.json() as Promise<{ restored: string[] }>
    },
    onSuccess: (r) => {
      toast.success(`Restored ${r.restored.join(' and ')}`)
      qc.invalidateQueries()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const doConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (which === 'restart') await run('system.restart_control', undefined, { success: 'Restarting the control process' })
    if (which === 'reboot') await run('system.reboot', undefined, { success: 'Rebooting' })
    if (which === 'shutdown') await run('system.shutdown', undefined, { success: 'Shutting down' })
  }

  const s = info.data?.system ?? {}
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">System</h1>
        <p className="text-sm text-muted-foreground">Hardware platform, processes, backups.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="size-4" /> This grill</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Version" value={info.data ? `${info.data.version.server} (${info.data.version.build})` : '…'} />
          <Info label="Board" value={info.data?.board ?? '—'} />
          <Info label="Platform module" value={info.data?.modules.grillplat ?? '—'} />
          <Info label="Display" value={info.data?.modules.display ?? '—'} />
          <Info label="CPU" value={s.cpu_percent != null ? `${s.cpu_percent}%` : '—'} />
          <Info label="Memory" value={s.memory_percent != null ? `${s.memory_percent}%` : '—'} />
          <Info label="Disk" value={s.disk_percent != null ? `${s.disk_percent}%` : '—'} />
          <Info label="Uptime" value={s.uptime_s != null ? fmtDuration(s.uptime_s) : '—'} />
        </CardContent>
      </Card>

      <SettingsSectionInline sectionId="system" />

      <UpdateCard cooking={!!cooking} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Backup &amp; restore</CardTitle>
          <CardDescription>The backup holds settings.json and the pellet database, including notification tokens. Keep it private.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.open(`${API_BASE}/api/v1/system/backup?token=${token ?? ''}`, '_blank')}>
            <Download className="size-4" /> Download backup
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={restore.isPending}>
            {restore.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Restore from file
          </Button>
          <input ref={fileRef} type="file" accept=".zip,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore.mutate(e.target.files[0])} />
        </CardContent>
      </Card>

      <MaintenanceCard />

      <ApiKeysCard />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Processes &amp; power</CardTitle>
          <CardDescription>{cooking ? 'A cook is running — restarting or powering off will stop it.' : 'The grill is idle.'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConfirm('restart')}><RotateCcw className="size-4" /> Restart control</Button>
          <Button variant="outline" onClick={() => setConfirm('reboot')}><RefreshCw className="size-4" /> Reboot Pi</Button>
          <Button variant="destructive" onClick={() => setConfirm('shutdown')}><Power className="size-4" /> Power off</Button>
        </CardContent>
      </Card>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'restart' ? 'Restart the control process?' : confirm === 'reboot' ? 'Reboot the Raspberry Pi?' : 'Power off the Raspberry Pi?'}</DialogTitle>
            <DialogDescription>
              {cooking ? 'The current cook stops and all outputs turn off. ' : ''}
              {confirm === 'shutdown' ? 'You will need to unplug and replug the Pi to start it again.' : 'The grill will be unreachable for a minute.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === 'shutdown' ? 'destructive' : 'default'} onClick={doConfirm}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  )
}
