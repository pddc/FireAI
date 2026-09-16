import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Flame } from 'lucide-react'
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Cooks</h1>
        <p className="text-sm text-muted-foreground">Every cook is saved automatically when the grill stops.</p>
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
                  {c.thumbnail && source ? <img src={source.cookAssetUrl(c.id, c.thumbnail, true)} alt="" className="size-10 rounded-lg object-cover" /> : <Flame className="size-5 text-ember" />}
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
