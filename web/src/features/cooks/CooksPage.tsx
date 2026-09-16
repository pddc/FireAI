import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Flame, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { upload } from '@/lib/api'
import { assetIdOf } from './CookDetailPage'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useGrill } from '@/stores/grill'
import { fmtDuration } from '@/lib/format'

function fmtDate(ms: number | null | undefined) {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function CooksPage() {
  const source = useGrill((s) => s.source)
  const cooks = useQuery({ queryKey: ['cooks', source?.kind], queryFn: () => source!.listCooks(), enabled: !!source })
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const importCook = useMutation({
    mutationFn: (file: File) => upload<{ filename: string }>('/api/v1/cooks/import', file),
    onSuccess: () => { toast.success('Cook imported'); qc.invalidateQueries({ queryKey: ['cooks'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Cooks</h1>
          <p className="text-sm text-muted-foreground">Every cook is saved automatically when the grill stops.</p>
        </div>
        {source?.kind === 'local' && (
          <>
            <input ref={fileInput} type="file" accept=".pifire,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importCook.mutate(f) }} />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={importCook.isPending}>
              {importCook.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Import
            </Button>
          </>
        )}
      </div>
      {!cooks.data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : cooks.data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No cooks yet. Fire it up and this is where the history lands.</CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {cooks.data.map((c, i) => {
            const dur = c.starttime && c.endtime ? (c.endtime - c.starttime) / 1000 : null
            return (
              <Link key={c.id} to={encodeURIComponent(c.id)} className={`flex items-center gap-3 p-4 transition-colors hover:bg-muted ${i > 0 ? 'border-t' : ''}`}>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ember-soft">
                  {assetIdOf(c.thumbnail) && source ? <img src={source.cookAssetUrl(c.id, assetIdOf(c.thumbnail)!, true)} alt="" className="size-10 rounded-lg object-cover" /> : <Flame className="size-5 text-ember" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {fmtDate(c.starttime)}
                    {dur ? ` · ${fmtDuration(dur)}` : c.status === 'active' ? ' · in progress' : ''}
                    {c.error ? ' · unreadable' : ''}
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
