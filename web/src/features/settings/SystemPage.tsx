import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, Power, RefreshCw, RotateCcw, Upload, Cpu } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { API_BASE, get } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useCommand } from '@/hooks/useCommand'
import { useGrillState } from '@/stores/grill'
import { fmtDuration } from '@/lib/format'
import { SettingsSectionInline } from './SettingsSectionInline'

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
