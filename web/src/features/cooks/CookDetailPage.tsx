import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Pencil, Trash2, MessageSquare, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TempChart, seriesFromRows } from '@/components/chart/TempChart'
import { useGrill } from '@/stores/grill'
import { fmtDuration, fmtTemp } from '@/lib/format'
import type { HistoryRow, Units } from '@/types/state'

function stats(rows: HistoryRow[]) {
  const pit = rows.map((r) => Object.values(r.P ?? {})[0]).filter((v): v is number => typeof v === 'number' && v > 0)
  const foods: Record<string, number> = {}
  for (const r of rows) for (const [k, v] of Object.entries(r.F ?? {})) if (typeof v === 'number' && v > (foods[k] ?? -Infinity)) foods[k] = v
  return {
    pitAvg: pit.length ? pit.reduce((a, b) => a + b, 0) / pit.length : null,
    pitMax: pit.length ? Math.max(...pit) : null,
    foodMax: foods,
    duration: rows.length > 1 ? (rows[rows.length - 1].T - rows[0].T) / 1000 : 0,
  }
}

export function CookDetailPage() {
  const { cookId } = useParams()
  const id = decodeURIComponent(cookId ?? '')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const source = useGrill((s) => s.source)
  const cook = useQuery({ queryKey: ['cook', source?.kind, id], queryFn: () => source!.getCook(id), enabled: !!source && !!id })
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const rename = useMutation({
    mutationFn: (t: string) => source!.updateCook(id, { title: t }),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['cook'] })
      qc.invalidateQueries({ queryKey: ['cooks'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const addComment = useMutation({
    mutationFn: (t: string) => source!.addCookComment(id, t),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['cook'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const del = useMutation({
    mutationFn: () => source!.deleteCook(id),
    onSuccess: () => {
      toast.success('Cook deleted')
      qc.invalidateQueries({ queryKey: ['cooks'] })
      navigate('..')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const series = useMemo(() => (cook.data ? seriesFromRows(cook.data.rows, cook.data.labels) : []), [cook.data])
  const st = useMemo(() => (cook.data ? stats(cook.data.rows) : null), [cook.data])

  if (cook.isError) return <Alert variant="destructive"><AlertDescription>{(cook.error as Error).message}</AlertDescription></Alert>
  if (!cook.data || !st) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }
  const d = cook.data
  const units = (d.metadata.units ?? 'F') as Units
  const displayTitle = d.metadata.title || d.filename || 'Cook'

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => navigate('..')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                rename.mutate(title)
              }}
            >
              <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="h-9 text-lg font-semibold" />
              <Button type="submit" size="icon-sm" aria-label="Save title" disabled={rename.isPending}><Check className="size-4" /></Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(false)}><X className="size-4" /></Button>
            </form>
          ) : (
            <button type="button" className="group flex items-center gap-2 text-left" onClick={() => { setTitle(d.metadata.title ?? ''); setEditing(true) }}>
              <h1 className="truncate text-xl font-semibold tracking-tight">{displayTitle}</h1>
              <Pencil className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {d.metadata.starttime ? new Date(d.metadata.starttime).toLocaleString() : ''}
            {st.duration ? ` · ${fmtDuration(st.duration)}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Delete cook" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pit average" value={fmtTemp(st.pitAvg, units)} />
        <Stat label="Pit peak" value={fmtTemp(st.pitMax, units)} />
        {Object.entries(st.foodMax).slice(0, 2).map(([k, v]) => (
          <Stat key={k} label={`${d.labels?.probes?.[k] ?? k} peak`} value={fmtTemp(v, units)} />
        ))}
      </div>

      <Card>
        <CardContent className="p-2 sm:p-4">
          {d.rows.length ? <TempChart rows={d.rows} series={series} /> : <div className="py-10 text-center text-sm text-muted-foreground">No temperature data in this cook.</div>}
        </CardContent>
      </Card>

      {d.assets.length > 0 && source && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {d.assets.map((a) => (
            <a key={a.id} href={source.cookAssetUrl(id, a.id)} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg bg-muted">
              <img src={source.cookAssetUrl(id, a.id, true)} alt="" className="size-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="size-4" /> Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {d.comments.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
          {d.comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="mb-1 text-xs text-muted-foreground">{c.date} {c.time}</div>
              <div className="whitespace-pre-wrap">{c.text}</div>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (comment.trim()) addComment.mutate(comment.trim())
            }}
          >
            <Input placeholder="Add a note about this cook…" value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button type="submit" disabled={!comment.trim() || addComment.isPending}>
              {addComment.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Add'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this cook?</DialogTitle>
            <DialogDescription>The temperature history, notes and photos are removed permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular">{value}</div>
    </div>
  )
}
