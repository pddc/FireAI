import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bug, Download, Eraser, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { del, downloadUrl, post } from '@/lib/api'
import { useCommand } from '@/hooks/useCommand'

const DATA_SETS: { id: string; label: string; desc: string }[] = [
  { id: 'history', label: 'Temperature history', desc: 'The live graph buffer for the current cook. Saved cook files are not affected.' },
  { id: 'events', label: 'Events', desc: 'The events log shown under Events & logs.' },
  { id: 'pellet_log', label: 'Pellet load log', desc: 'The history of pellet loads; profiles and brands stay.' },
  { id: 'pellet_db', label: 'Pellet database', desc: 'Profiles, brands, woods and the log, back to defaults.' },
  { id: 'logs', label: 'Log files', desc: 'control, server, bridge and rotated logs.' },
]

/** PiFire's Admin → data management: delete runtime data, download logs / debug bundle, factory reset. */
export function MaintenanceCard() {
  const qc = useQueryClient()
  const { run } = useCommand()
  const [confirmClear, setConfirmClear] = useState<(typeof DATA_SETS)[number] | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetWord, setResetWord] = useState('')
  const [resetDone, setResetDone] = useState(false)

  const clear = useMutation({
    mutationFn: (id: string) => del(`/api/v1/system/data/${id}`),
    onSuccess: (_, id) => {
      toast.success(`${DATA_SETS.find((d) => d.id === id)?.label} cleared`)
      setConfirmClear(null)
      qc.invalidateQueries()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const reset = useMutation({
    mutationFn: () => post<{ ok: boolean; restart_required: boolean }>('/api/v1/system/factory-reset', { confirm: resetWord }),
    onSuccess: () => { setResetDone(true); qc.invalidateQueries() },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Eraser className="size-4" /> Maintenance</CardTitle>
        <CardDescription>Clear runtime data, grab logs for a support request, or start over. Cook files and recipes are never deleted here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={downloadUrl('/api/v1/system/logs.zip')} download />}>
            <Download className="size-4" /> Download logs
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={downloadUrl('/api/v1/system/debug.zip')} download />}>
            <Bug className="size-4" /> Debug bundle
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border text-sm">
          {DATA_SETS.map((d, i) => (
            <div key={d.id} className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? 'border-t' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{d.label}</div>
                <div className="text-xs text-muted-foreground">{d.desc}</div>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Clear ${d.label}`} onClick={() => setConfirmClear(d)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="destructive" size="sm" onClick={() => { setResetWord(''); setResetDone(false); setResetOpen(true) }}>
          <AlertTriangle className="size-4" /> Factory reset
        </Button>
      </CardContent>

      <Dialog open={!!confirmClear} onOpenChange={(o) => !o && setConfirmClear(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {confirmClear?.label.toLowerCase()}?</DialogTitle>
            <DialogDescription>{confirmClear?.desc} This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmClear && clear.mutate(confirmClear.id)} disabled={clear.isPending}>
              {clear.isPending && <Loader2 className="size-4 animate-spin" />} Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resetDone ? 'Reset complete' : 'Reset to factory settings?'}</DialogTitle>
            <DialogDescription>
              {resetDone
                ? 'Settings, pellet database and history are back to defaults. Restart the control process, then the app will take you through setup again. Your password was kept.'
                : 'Every setting, the pellet database, the control state and the history go back to defaults. Cook files, recipes and your admin password are kept. Type RESET to confirm.'}
            </DialogDescription>
          </DialogHeader>
          {!resetDone && <Input value={resetWord} onChange={(e) => setResetWord(e.target.value)} placeholder="RESET" aria-label="Type RESET to confirm" autoFocus />}
          <DialogFooter>
            {resetDone ? (
              <Button onClick={() => { run('system.restart_control', undefined, { success: 'Restarting control' }); setResetOpen(false) }}>Restart control now</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={() => reset.mutate()} disabled={resetWord !== 'RESET' || reset.isPending}>
                  {reset.isPending && <Loader2 className="size-4 animate-spin" />} Reset everything
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
