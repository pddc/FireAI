import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Pencil, Trash2, MessageSquare, Check, X, Camera, Download, ImageIcon, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TempChart, seriesFromRows } from '@/components/chart/TempChart'
import { useGrill } from '@/stores/grill'
import { del, downloadUrl, put, upload } from '@/lib/api'
import { fmtDuration, fmtTemp } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CookAsset, CookComment, HistoryRow, Units } from '@/types/state'

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

/** PiFire stores the cover as "<assetId>.<ext>"; the API serves assets by id. */
export function assetIdOf(thumbnail: string | undefined | null): string | null {
  if (!thumbnail) return null
  return thumbnail.includes('.') ? thumbnail.slice(0, thumbnail.lastIndexOf('.')) : thumbnail
}

export function CookDetailPage() {
  const { cookId } = useParams()
  const id = decodeURIComponent(cookId ?? '')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const source = useGrill((s) => s.source)
  const local = source?.kind === 'local'
  const cook = useQuery({ queryKey: ['cook', source?.kind, id], queryFn: () => source!.getCook(id), enabled: !!source && !!id })
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [editComment, setEditComment] = useState<{ id: string; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lightbox, setLightbox] = useState<CookAsset | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const [photoTarget, setPhotoTarget] = useState<string | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cook'] })
    qc.invalidateQueries({ queryKey: ['cooks'] })
  }
  const onError = (e: unknown) => toast.error((e as Error).message)
  const base = `/api/v1/cooks/${encodeURIComponent(id)}`

  const rename = useMutation({ mutationFn: (t: string) => source!.updateCook(id, { title: t }), onSuccess: () => { setEditing(false); refresh() }, onError })
  const addComment = useMutation({ mutationFn: (t: string) => source!.addCookComment(id, t), onSuccess: () => { setComment(''); refresh() }, onError })
  const saveComment = useMutation({ mutationFn: (c: { id: string; text: string }) => put(`${base}/comments/${c.id}`, { text: c.text }), onSuccess: () => { setEditComment(null); refresh() }, onError })
  const removeComment = useMutation({ mutationFn: (cid: string) => del(`${base}/comments/${cid}`), onSuccess: refresh, onError })
  const addPhoto = useMutation({
    mutationFn: ({ file, commentId, cover }: { file: File; commentId?: string | null; cover?: boolean }) =>
      upload<CookAsset>(`${base}/assets?${commentId ? `comment_id=${commentId}&` : ''}thumbnail=${cover ? 'true' : 'false'}`, file),
    onSuccess: () => { toast.success('Photo added'); refresh() },
    onError,
  })
  const removePhoto = useMutation({ mutationFn: (aid: string) => del(`${base}/assets/${aid}`), onSuccess: () => { setLightbox(null); refresh() }, onError })
  const setCover = useMutation({ mutationFn: (aid: string | null) => put(`${base}/thumbnail`, { asset_id: aid }), onSuccess: () => { toast.success('Cover photo set'); refresh() }, onError })
  const delCook = useMutation({ mutationFn: () => source!.deleteCook(id), onSuccess: () => { toast.success('Cook deleted'); qc.invalidateQueries({ queryKey: ['cooks'] }); navigate('..') }, onError })

  const pickPhoto = (commentId: string | null) => {
    setPhotoTarget(commentId)
    photoInput.current?.click()
  }
  const onPhotoChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    addPhoto.mutate({ file, commentId: photoTarget, cover: !cook.data?.metadata.thumbnail })
  }

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
  const coverId = assetIdOf(d.metadata.thumbnail)
  const assetById = (aid: string) => d.assets.find((a) => a.id === aid || a.filename === aid)

  return (
    <div className="space-y-4">
      <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={onPhotoChosen} data-testid="photo-input" />
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
        {local && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Add photo" onClick={() => pickPhoto(null)} disabled={addPhoto.isPending}>
              {addPhoto.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Download cook file" nativeButton={false} render={<a href={downloadUrl(`${base}/download`)} download />}>
              <Download className="size-4" />
            </Button>
          </>
        )}
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
            <button key={a.id} type="button" onClick={() => setLightbox(a)} className={cn('relative aspect-square overflow-hidden rounded-lg bg-muted', a.id === coverId && 'ring-2 ring-ember')} aria-label="Open photo">
              <img src={source.cookAssetUrl(id, a.id, true)} alt="" className="size-full object-cover" loading="lazy" />
              {a.id === coverId && <Star className="absolute right-1 top-1 size-4 fill-ember text-ember" />}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="size-4" /> Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {d.comments.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
          {d.comments.map((c: CookComment) => (
            <div key={c.id} className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1">{c.date} {c.time}{c.edited ? ' · edited' : ''}</span>
                {local && editComment?.id !== c.id && (
                  <>
                    <button type="button" className="hover:text-foreground" aria-label="Add photo to note" onClick={() => pickPhoto(c.id)}><ImageIcon className="size-3.5" /></button>
                    <button type="button" className="hover:text-foreground" aria-label="Edit note" onClick={() => setEditComment({ id: c.id, text: c.text })}><Pencil className="size-3.5" /></button>
                    <button type="button" className="hover:text-destructive" aria-label="Delete note" onClick={() => removeComment.mutate(c.id)}><Trash2 className="size-3.5" /></button>
                  </>
                )}
              </div>
              {editComment?.id === c.id ? (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (editComment.text.trim()) saveComment.mutate(editComment) }}>
                  <Input value={editComment.text} onChange={(e) => setEditComment({ id: c.id, text: e.target.value })} autoFocus />
                  <Button type="submit" size="icon-sm" aria-label="Save note" disabled={saveComment.isPending}><Check className="size-4" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel edit" onClick={() => setEditComment(null)}><X className="size-4" /></Button>
                </form>
              ) : (
                <div className="whitespace-pre-wrap">{c.text}</div>
              )}
              {!!c.assets?.length && source && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.assets.map(assetById).filter((a): a is CookAsset => !!a).map((a) => (
                    <button key={a.id} type="button" onClick={() => setLightbox(a)} aria-label="Open photo">
                      <img src={source.cookAssetUrl(id, a.id, true)} alt="" className="size-14 rounded-md object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
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

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Photo</DialogTitle>
            <DialogDescription>Cook photo</DialogDescription>
          </DialogHeader>
          {lightbox && source && <img src={source.cookAssetUrl(id, lightbox.id)} alt="" className="max-h-[75vh] w-full rounded-lg object-contain" />}
          {lightbox && local && (
            <DialogFooter className="flex-row justify-end gap-2 px-2 pb-2">
              <Button variant="outline" size="sm" onClick={() => setCover.mutate(lightbox.id === coverId ? null : lightbox.id)} disabled={setCover.isPending}>
                <Star className={cn('size-4', lightbox.id === coverId && 'fill-ember text-ember')} /> {lightbox.id === coverId ? 'Unset cover' : 'Use as cover'}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => removePhoto.mutate(lightbox.id)} disabled={removePhoto.isPending}>
                <Trash2 className="size-4" /> Delete photo
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this cook?</DialogTitle>
            <DialogDescription>The temperature history, notes and photos are removed permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => delCook.mutate()} disabled={delCook.isPending}>Delete</Button>
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
