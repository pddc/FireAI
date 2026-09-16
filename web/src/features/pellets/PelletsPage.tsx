import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Plus, RefreshCw, Star, Trash2, Pencil, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { NativeSelect } from '@/components/ui/native-select'
import { api, post } from '@/lib/api'
import { useGrill, useGrillState } from '@/stores/grill'
import { useCommand } from '@/hooks/useCommand'
import { IS_CLOUD } from '@/lib/mode'
import { cn } from '@/lib/utils'

interface Profile {
  id: string
  brand: string
  wood: string
  rating: number
  comments: string
}
interface PelletDb {
  current: { pelletid: string; hopper_level: number; date_loaded: string; est_usage: number }
  archive: Record<string, Profile>
  brands: string[]
  woods: string[]
  log: Record<string, string>
}

function Stars({ n, onChange }: { n: number; onChange?: (v: number) => void }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" disabled={!onChange} onClick={() => onChange?.(i)} className="p-0.5" aria-label={`${i} stars`}>
          <Star className={cn('size-4', i <= n ? 'fill-warn text-warn' : 'text-muted-foreground/40')} />
        </button>
      ))}
    </span>
  )
}

export function PelletsPage() {
  const qc = useQueryClient()
  const source = useGrill((s) => s.source)
  const state = useGrillState()
  const { run } = useCommand()
  const db = useQuery({ queryKey: ['pellets', source?.kind], queryFn: () => source!.getPellets() as unknown as Promise<PelletDb>, enabled: !!source })
  const [sheet, setSheet] = useState<{ profile: Partial<Profile>; load: boolean } | null>(null)
  const readOnly = IS_CLOUD

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pellets'] })
  const load = useMutation({ mutationFn: (id: string) => post(`/api/v1/pellets/load/${id}`), onSuccess: () => { toast.success('Pellets loaded'); invalidate() }, onError: (e) => toast.error((e as Error).message) })
  const upsert = useMutation({
    mutationFn: (p: Partial<Profile> & { load: boolean }) => api('/api/v1/pellets/profiles', { method: 'PUT', body: JSON.stringify(p) }),
    onSuccess: () => { setSheet(null); invalidate() },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/pellets/profiles/${id}`, { method: 'DELETE' }), onSuccess: invalidate, onError: (e) => toast.error((e as Error).message) })
  const removeLog = useMutation({ mutationFn: (when: string) => api(`/api/v1/pellets/log/${encodeURIComponent(when)}`, { method: 'DELETE' }), onSuccess: invalidate })

  if (!db.data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />
  const d = db.data
  const current = d.archive[d.current.pelletid]
  const level = state?.hopper.level ?? d.current.hopper_level
  const usageKg = (d.current.est_usage / 1000).toFixed(2)
  const log = Object.entries(d.log ?? {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 20)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pellets</h1>
        <p className="text-sm text-muted-foreground">What is in the hopper, how much is left, and what you have tried.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Package className="size-4 text-ember" /> In the hopper</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="relative h-24 w-14 overflow-hidden rounded-lg border bg-muted">
              <div className={cn('absolute inset-x-0 bottom-0 transition-[height] duration-700', level < 20 ? 'bg-warn' : 'bg-ember')} style={{ height: `${Math.max(0, Math.min(100, level ?? 0))}%` }} />
            </div>
            <div className="flex-1">
              <div className="text-3xl font-semibold tabular">{state?.hopper.enabled || level != null ? `${level}%` : '—'}</div>
              <div className="text-sm">{current ? `${current.brand} ${current.wood}` : 'Unknown pellets'}</div>
              <div className="text-xs text-muted-foreground">Loaded {d.current.date_loaded} · ~{usageKg} kg used since</div>
            </div>
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => run('hopper.check')}>
                <RefreshCw className="size-4" /> Re-check
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Pellet profiles</CardTitle>
              <CardDescription>Load a profile when you fill the hopper so usage and history stay accurate.</CardDescription>
            </div>
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={() => setSheet({ profile: { brand: d.brands[0] ?? 'Generic', wood: d.woods[0] ?? 'Blend', rating: 4, comments: '' }, load: true })}>
                <Plus className="size-4" /> New
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="divide-y">
          {Object.values(d.archive).map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.brand} {p.wood} {p.id === d.current.pelletid && <Badge>loaded</Badge>}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Stars n={p.rating} /> <span className="truncate">{p.comments}</span>
                </div>
              </div>
              {!readOnly && p.id !== d.current.pelletid && (
                <Button size="sm" variant="outline" onClick={() => load.mutate(p.id)} disabled={load.isPending}>
                  <Upload className="size-4" /> Load
                </Button>
              )}
              {!readOnly && (
                <>
                  <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setSheet({ profile: { ...p }, load: false })}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Delete" disabled={p.id === d.current.pelletid} onClick={() => remove.mutate(p.id)}><Trash2 className="size-4 text-destructive" /></Button>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Load history</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {log.map(([when, pid]) => (
              <div key={when} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-40 shrink-0 tabular text-muted-foreground">{when}</span>
                <span className="flex-1 truncate">{d.archive[pid] ? `${d.archive[pid].brand} ${d.archive[pid].wood}` : pid}</span>
                {!readOnly && <Button variant="ghost" size="icon-xs" aria-label="Remove entry" onClick={() => removeLog.mutate(when)}><Trash2 className="size-3" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
          {sheet && (
            <>
              <SheetHeader>
                <SheetTitle>{sheet.profile.id ? 'Edit pellets' : 'New pellets'}</SheetTitle>
                <SheetDescription>Brand and wood are added to your lists automatically.</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="pbrand">Brand</Label>
                    <Input id="pbrand" list="brands" value={sheet.profile.brand ?? ''} onChange={(e) => setSheet({ ...sheet, profile: { ...sheet.profile, brand: e.target.value } })} />
                    <datalist id="brands">{d.brands.map((b) => <option key={b} value={b} />)}</datalist>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pwood">Wood</Label>
                    <NativeSelect id="pwood" value={sheet.profile.wood ?? ''} onValueChange={(v) => setSheet({ ...sheet, profile: { ...sheet.profile, wood: v } })} options={[...new Set([...(d.woods ?? []), sheet.profile.wood ?? ''])].filter(Boolean).map((w) => ({ value: w, label: w }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Rating</Label>
                  <div><Stars n={sheet.profile.rating ?? 0} onChange={(v) => setSheet({ ...sheet, profile: { ...sheet.profile, rating: v } })} /></div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pcomments">Notes</Label>
                  <textarea id="pcomments" className="min-h-20 w-full rounded-lg border bg-background p-2 text-sm" value={sheet.profile.comments ?? ''} onChange={(e) => setSheet({ ...sheet, profile: { ...sheet.profile, comments: e.target.value } })} />
                </div>
                {!sheet.profile.id && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={sheet.load} onChange={(e) => setSheet({ ...sheet, load: e.target.checked })} /> Load into the hopper now
                  </label>
                )}
                <Button className="w-full" size="lg" disabled={upsert.isPending || !sheet.profile.brand || !sheet.profile.wood} onClick={() => upsert.mutate({ ...sheet.profile, load: sheet.load })}>
                  {upsert.isPending && <Loader2 className="size-4 animate-spin" />} Save
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
