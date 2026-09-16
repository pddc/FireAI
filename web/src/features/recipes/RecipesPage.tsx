import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronLeft, Loader2, Play, Plus, Save, Trash2, ArrowUp, ArrowDown, FastForward, Camera, Download, Upload, Star, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { NativeSelect } from '@/components/ui/native-select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, del, downloadUrl, get, post, upload } from '@/lib/api'
import { cn } from '@/lib/utils'
import { assetIdOf } from '@/features/cooks/CookDetailPage'
import { useCommand } from '@/hooks/useCommand'
import { useGrillState } from '@/stores/grill'
import { IS_CLOUD } from '@/lib/mode'
import { fmtTemp } from '@/lib/format'

interface Step {
  mode: 'Startup' | 'Smoke' | 'Hold' | 'Shutdown'
  trigger_temps: { primary: number; food: number[] }
  hold_temp: number
  timer: number
  notify: boolean
  message: string
  pause: boolean
}
interface Asset {
  id: string
  filename: string
  type: string
}
interface Comment {
  id: string
  username?: string
  text: string
  rating?: number
  date: string
  time: string
  assets?: string[]
}
interface Recipe {
  filename: string
  metadata: { title: string; description: string; author: string; rating: number; prep_time: number; cook_time: number; difficulty: string; units: string; food_probes: number; image?: string; thumbnail?: string }
  recipe: { ingredients: { name: string; quantity: string; assets?: string[] }[]; instructions: { text: string; step: number; assets?: string[] }[]; steps: Step[] }
  comments?: Comment[]
  assets: Asset[]
}
interface Summary {
  filename: string
  title: string
  description: string
  cook_time: number
  difficulty: string
  thumbnail?: string
  comment_rating?: number | null
  comments?: number
  error?: string
}

const DIFFICULTIES = ['Easy', 'Medium', 'Hard']

export function recipeAssetUrl(filename: string, assetId: string, thumb = false) {
  return downloadUrl(`/api/v1/recipes/${encodeURIComponent(filename)}/assets/${assetId}?thumb=${thumb}`)
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)}>
          <Star className={cn('size-5', n <= value ? 'fill-ember text-ember' : 'text-muted-foreground')} />
        </button>
      ))}
    </div>
  )
}

/** Thumbnails attached to an ingredient or instruction row. */
function RowPhotos({ filename, ids, assets, onOpen }: { filename: string; ids: string[] | undefined; assets: Asset[]; onOpen: (a: Asset) => void }) {
  const rows = (ids ?? []).map((id) => assets.find((a) => a.id === id || a.filename === id)).filter((a): a is Asset => !!a)
  if (!rows.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 pl-8">
      {rows.map((a) => (
        <button key={a.id} type="button" onClick={() => onOpen(a)} aria-label="Open photo">
          <img src={recipeAssetUrl(filename, a.id, true)} alt="" className="size-12 rounded-md object-cover" loading="lazy" />
        </button>
      ))}
    </div>
  )
}

const blankStep = (food: number): Step => ({ mode: 'Hold', trigger_temps: { primary: 0, food: Array(food).fill(0) }, hold_temp: 225, timer: 0, notify: false, message: '', pause: false })

function StepEditor({ step, index, units, foodLabels, onChange, onRemove, onMove }: { step: Step; index: number; units: string; foodLabels: string[]; onChange: (s: Step) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void }) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Step {index + 1}</Badge>
        <NativeSelect className="w-40" value={step.mode} onValueChange={(v) => onChange({ ...step, mode: v as Step['mode'] })} options={['Startup', 'Smoke', 'Hold', 'Shutdown'].map((m) => ({ value: m, label: m }))} />
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Move up" onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Move down" onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Remove step" onClick={onRemove}><Trash2 className="size-4 text-destructive" /></Button>
      </div>
      {step.mode === 'Hold' && (
        <div className="space-y-1">
          <Label className="text-xs">Hold temperature ({units === 'C' ? '°C' : '°F'})</Label>
          <Input type="number" className="w-32" value={step.hold_temp} onChange={(e) => onChange({ ...step, hold_temp: Number(e.target.value) })} />
        </div>
      )}
      {(step.mode === 'Smoke' || step.mode === 'Hold') && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Pit reaches</Label>
            <Input type="number" value={step.trigger_temps.primary} onChange={(e) => onChange({ ...step, trigger_temps: { ...step.trigger_temps, primary: Number(e.target.value) } })} />
          </div>
          {foodLabels.map((lbl, i) => (
            <div key={lbl} className="space-y-1">
              <Label className="text-xs">{lbl} reaches</Label>
              <Input type="number" value={step.trigger_temps.food[i] ?? 0} onChange={(e) => { const food = [...step.trigger_temps.food]; food[i] = Number(e.target.value); onChange({ ...step, trigger_temps: { ...step.trigger_temps, food } }) }} />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Timer (min)</Label>
            <Input type="number" value={step.timer} onChange={(e) => onChange({ ...step, timer: Number(e.target.value) })} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><Switch checked={step.notify} onCheckedChange={(c) => onChange({ ...step, notify: c })} /> Notify</label>
        <label className="flex items-center gap-2"><Switch checked={step.pause} onCheckedChange={(c) => onChange({ ...step, pause: c })} /> Pause until continued</label>
        {step.notify && <Input placeholder="Message" className="flex-1 min-w-40" value={step.message} onChange={(e) => onChange({ ...step, message: e.target.value })} />}
      </div>
      <p className="text-xs text-muted-foreground">0 means the trigger is not used. The step ends when any trigger fires (or immediately for Startup/Shutdown).</p>
    </div>
  )
}

export function RecipesPage() {
  const qc = useQueryClient()
  const state = useGrillState()
  const { run } = useCommand()
  const list = useQuery({ queryKey: ['recipes'], queryFn: () => get<{ recipes: Summary[] }>('/api/v1/recipes'), enabled: !IS_CLOUD })
  const [selected, setSelected] = useState<string | null>(null)
  const recipe = useQuery({ queryKey: ['recipe', selected], queryFn: () => get<Recipe>(`/api/v1/recipes/${encodeURIComponent(selected!)}`), enabled: !!selected })
  const [draft, setDraft] = useState<Recipe | null>(null)
  const [confirmRun, setConfirmRun] = useState(false)
  const [lightbox, setLightbox] = useState<Asset | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [photoTarget, setPhotoTarget] = useState<{ target?: 'ingredients' | 'instructions' | 'comments'; index?: number; cover?: boolean }>({})
  const [commentText, setCommentText] = useState('')
  const [commentRating, setCommentRating] = useState(0)
  const units = state?.units ?? 'F'
  const foodLabels = state?.probes.filter((p) => p.type === 'Food' && p.enabled).map((p) => p.name) ?? ['Probe 1', 'Probe 2']

  useEffect(() => {
    if (recipe.data) setDraft(structuredClone(recipe.data))
  }, [recipe.data])

  const create = useMutation({
    mutationFn: () => post<{ filename: string }>('/api/v1/recipes', { title: 'New recipe' }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['recipes'] }); setSelected(r.filename) },
    onError: (e) => toast.error((e as Error).message),
  })
  const save = useMutation({
    mutationFn: async (d: Recipe) => {
      await api(`/api/v1/recipes/${encodeURIComponent(d.filename)}`, { method: 'PUT', body: JSON.stringify({ part: 'metadata', data: d.metadata }) })
      await api(`/api/v1/recipes/${encodeURIComponent(d.filename)}`, { method: 'PUT', body: JSON.stringify({ part: 'recipe', data: d.recipe }) })
    },
    onSuccess: () => { toast.success('Recipe saved'); qc.invalidateQueries({ queryKey: ['recipes'] }); qc.invalidateQueries({ queryKey: ['recipe'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: (fn: string) => api(`/api/v1/recipes/${encodeURIComponent(fn)}`, { method: 'DELETE' }),
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ['recipes'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const importRecipe = useMutation({
    mutationFn: (file: File) => upload<{ filename: string }>('/api/v1/recipes/import', file),
    onSuccess: (r) => { toast.success('Recipe imported'); qc.invalidateQueries({ queryKey: ['recipes'] }); setSelected(r.filename) },
    onError: (e) => toast.error((e as Error).message),
  })
  // Photos are written to the file immediately; the draft is patched in place so unsaved edits survive.
  const addPhoto = useMutation({
    mutationFn: ({ file, target, index, cover }: { file: File } & typeof photoTarget) => {
      const q = new URLSearchParams()
      if (target && index != null) { q.set('target', target); q.set('index', String(index)) }
      if (cover) q.set('cover', 'true')
      return upload<Asset>(`/api/v1/recipes/${encodeURIComponent(selected!)}/assets?${q}`, file)
    },
    onSuccess: (asset, vars) => {
      setDraft((d) => {
        if (!d) return d
        const next = structuredClone(d)
        next.assets = [...(next.assets ?? []), asset]
        if (vars.cover) { next.metadata.image = asset.filename; next.metadata.thumbnail = asset.filename }
        if (vars.target === 'comments' && vars.index != null && next.comments?.[vars.index]) {
          next.comments[vars.index].assets = [...(next.comments[vars.index].assets ?? []), asset.id]
        } else if (vars.target && vars.target !== 'comments' && vars.index != null) {
          const row = next.recipe[vars.target][vars.index] as { assets?: string[] }
          row.assets = [...(row.assets ?? []), asset.id]
        }
        return next
      })
      qc.setQueryData<Recipe>(['recipe', selected], (r) => {
        if (!r) return r
        const next = structuredClone(r)
        next.assets = [...(next.assets ?? []), asset]
        if (vars.cover) { next.metadata.image = asset.filename; next.metadata.thumbnail = asset.filename }
        if (vars.target === 'comments' && vars.index != null && next.comments?.[vars.index]) {
          next.comments[vars.index].assets = [...(next.comments[vars.index].assets ?? []), asset.id]
        } else if (vars.target && vars.target !== 'comments' && vars.index != null) {
          const row = next.recipe[vars.target][vars.index] as { assets?: string[] }
          row.assets = [...(row.assets ?? []), asset.id]
        }
        return next
      })
      qc.invalidateQueries({ queryKey: ['recipes'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const removePhoto = useMutation({
    mutationFn: (aid: string) => del(`/api/v1/recipes/${encodeURIComponent(selected!)}/assets/${aid}`),
    onSuccess: (_, aid) => {
      const strip = (r: Recipe) => {
        const next = structuredClone(r)
        const a = next.assets.find((x) => x.id === aid)
        next.assets = next.assets.filter((x) => x.id !== aid)
        if (a && (next.metadata.image === a.filename || next.metadata.thumbnail === a.filename)) { next.metadata.image = ''; next.metadata.thumbnail = '' }
        for (const row of [...next.recipe.ingredients, ...next.recipe.instructions, ...(next.comments ?? [])]) row.assets = (row.assets ?? []).filter((x) => x !== aid && x !== a?.filename)
        return next
      }
      setDraft((d) => (d ? strip(d) : d))
      qc.setQueryData<Recipe>(['recipe', selected], (r) => (r ? strip(r) : r))
      qc.invalidateQueries({ queryKey: ['recipes'] })
      setLightbox(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const pickPhoto = (t: typeof photoTarget) => { setPhotoTarget(t); photoInput.current?.click() }
  const applyComments = (comments: Comment[]) => {
    setDraft((d) => (d ? { ...d, comments } : d))
    qc.setQueryData<Recipe>(['recipe', selected], (r) => (r ? { ...r, comments } : r))
    qc.invalidateQueries({ queryKey: ['recipes'] })
  }
  const addComment = useMutation({
    mutationFn: () => post<{ comments: Comment[] }>(`/api/v1/recipes/${encodeURIComponent(selected!)}/comments`, { text: commentText.trim(), rating: commentRating || null }),
    onSuccess: (r) => { applyComments(r.comments); setCommentText(''); setCommentRating(0) },
    onError: (e) => toast.error((e as Error).message),
  })
  const removeComment = useMutation({
    mutationFn: (id: string) => del<{ comments: Comment[] }>(`/api/v1/recipes/${encodeURIComponent(selected!)}/comments/${id}`),
    onSuccess: (r) => applyComments(r.comments),
    onError: (e) => toast.error((e as Error).message),
  })

  const running = state?.mode === 'Recipe'

  if (IS_CLOUD) {
    return (
      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Recipes are edited on the grill's local app for now.{running ? ' A recipe is running.' : ''}</CardContent></Card>
    )
  }

  if (selected && draft) {
    const d = draft
    const dirty = JSON.stringify(draft) !== JSON.stringify(recipe.data)
    const setStep = (i: number, s: Step) => setDraft({ ...d, recipe: { ...d.recipe, steps: d.recipe.steps.map((x, j) => (j === i ? s : x)) } })
    const setMeta = (m: Partial<Recipe['metadata']>) => setDraft({ ...d, metadata: { ...d.metadata, ...m } })
    const coverId = assetIdOf(d.metadata.image || d.metadata.thumbnail)
    return (
      <div className="space-y-4">
        <input ref={photoInput} type="file" accept="image/*" className="hidden" data-testid="recipe-photo-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addPhoto.mutate({ file: f, ...photoTarget }) }} />
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => setSelected(null)}><ChevronLeft className="size-4" /></Button>
          <div className="flex-1 space-y-1">
            <Input className="text-lg font-semibold" value={d.metadata.title} placeholder="Recipe title" onChange={(e) => setMeta({ title: e.target.value })} />
            <Input value={d.metadata.description} placeholder="Short description" onChange={(e) => setMeta({ description: e.target.value })} />
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Download recipe" nativeButton={false} render={<a href={downloadUrl(`/api/v1/recipes/${encodeURIComponent(d.filename)}/download`)} download />}><Download className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove.mutate(d.filename)}><Trash2 className="size-4 text-destructive" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirmRun(true)} disabled={running || dirty}><Play className="size-4" /> Run recipe</Button>
          {dirty && <Button variant="outline" onClick={() => save.mutate(d)} disabled={save.isPending}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>}
          {running && <Button variant="outline" onClick={() => run('recipe.continue', undefined, { success: 'Continuing' })}><FastForward className="size-4" /> Continue paused step</Button>}
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
            <button type="button" className="relative flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted sm:w-56" aria-label={coverId ? 'Open cover photo' : 'Add cover photo'} onClick={() => (coverId ? setLightbox(d.assets.find((a) => a.id === coverId) ?? null) : pickPhoto({ cover: true }))} disabled={addPhoto.isPending}>
              {coverId ? <img src={recipeAssetUrl(d.filename, coverId)} alt="" className="size-full object-cover" /> : addPhoto.isPending ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><Camera className="size-6" /> Add cover photo</span>}
            </button>
            <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
              <label className="col-span-2 space-y-1"><span className="text-xs text-muted-foreground">Author</span><Input value={d.metadata.author} onChange={(e) => setMeta({ author: e.target.value })} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Prep time (min)</span><Input type="number" min={0} value={d.metadata.prep_time} onChange={(e) => setMeta({ prep_time: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Cook time (min)</span><Input type="number" min={0} value={d.metadata.cook_time} onChange={(e) => setMeta({ cook_time: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Difficulty</span><NativeSelect value={d.metadata.difficulty} onValueChange={(difficulty) => setMeta({ difficulty })} options={DIFFICULTIES.map((x) => ({ value: x, label: x }))} /></label>
              <div className="space-y-1"><span className="text-xs text-muted-foreground">Rating</span><Stars value={d.metadata.rating} onChange={(rating) => setMeta({ rating })} /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Program</CardTitle>
            <CardDescription>The grill follows these steps in order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.recipe.steps.map((s, i) => (
              <StepEditor
                key={i}
                step={s}
                index={i}
                units={units}
                foodLabels={foodLabels}
                onChange={(ns) => setStep(i, ns)}
                onRemove={() => setDraft({ ...d, recipe: { ...d.recipe, steps: d.recipe.steps.filter((_, j) => j !== i) } })}
                onMove={(dir) => {
                  const j = i + dir
                  if (j < 0 || j >= d.recipe.steps.length) return
                  const steps = [...d.recipe.steps]
                  ;[steps[i], steps[j]] = [steps[j], steps[i]]
                  setDraft({ ...d, recipe: { ...d.recipe, steps } })
                }}
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, steps: [...d.recipe.steps, blankStep(foodLabels.length)] } })}><Plus className="size-4" /> Add step</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ingredients</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.recipe.ingredients.map((ing, i) => (
              <div key={i} className="space-y-1">
                <div className="flex gap-2">
                  <Input className="w-28" placeholder="Qty" value={ing.quantity} onChange={(e) => setDraft({ ...d, recipe: { ...d.recipe, ingredients: d.recipe.ingredients.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) } })} />
                  <Input placeholder="Ingredient" value={ing.name} onChange={(e) => setDraft({ ...d, recipe: { ...d.recipe, ingredients: d.recipe.ingredients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } })} />
                  <Button variant="ghost" size="icon-sm" aria-label="Add ingredient photo" disabled={dirty} title={dirty ? 'Save first' : undefined} onClick={() => pickPhoto({ target: 'ingredients', index: i })}><ImageIcon className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, ingredients: d.recipe.ingredients.filter((_, j) => j !== i) } })}><Trash2 className="size-4" /></Button>
                </div>
                <RowPhotos filename={d.filename} ids={ing.assets} assets={d.assets} onOpen={setLightbox} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, ingredients: [...d.recipe.ingredients, { name: '', quantity: '', assets: [] }] } })}><Plus className="size-4" /> Add ingredient</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Instructions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.recipe.instructions.map((ins, i) => (
              <div key={i} className="space-y-1">
                <div className="flex gap-2">
                  <span className="mt-2 w-6 text-sm text-muted-foreground">{i + 1}.</span>
                  <textarea className="min-h-16 flex-1 rounded-lg border bg-background p-2 text-sm" value={ins.text} onChange={(e) => setDraft({ ...d, recipe: { ...d.recipe, instructions: d.recipe.instructions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) } })} />
                  <div className="flex flex-col">
                    <Button variant="ghost" size="icon-sm" aria-label="Add instruction photo" disabled={dirty} title={dirty ? 'Save first' : undefined} onClick={() => pickPhoto({ target: 'instructions', index: i })}><ImageIcon className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, instructions: d.recipe.instructions.filter((_, j) => j !== i) } })}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <RowPhotos filename={d.filename} ids={ins.assets} assets={d.assets} onOpen={setLightbox} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, instructions: [...d.recipe.instructions, { text: '', step: 0, assets: [] }] } })}><Plus className="size-4" /> Add instruction</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Comments</CardTitle>
            <CardDescription>How did it turn out? Ratings here roll up to the recipe list.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(d.comments ?? []).map((c, i) => (
              <div key={c.id} className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex-1">{c.username ? `${c.username} · ` : ''}{c.date} {c.time}</span>
                  {!!c.rating && <span className="flex items-center gap-0.5" aria-label={`${c.rating} stars`}>{Array.from({ length: c.rating }).map((_, k) => <Star key={k} className="size-3 fill-ember text-ember" />)}</span>}
                  <button type="button" className="hover:text-foreground" aria-label="Add photo to comment" onClick={() => pickPhoto({ target: 'comments', index: i })}><ImageIcon className="size-3.5" /></button>
                  <button type="button" className="hover:text-destructive" aria-label="Delete comment" onClick={() => removeComment.mutate(c.id)}><Trash2 className="size-3.5" /></button>
                </div>
                <div className="whitespace-pre-wrap">{c.text}</div>
                <RowPhotos filename={d.filename} ids={c.assets} assets={d.assets} onOpen={setLightbox} />
              </div>
            ))}
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (commentText.trim()) addComment.mutate() }}>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Your rating</span>
                <Stars value={commentRating} onChange={setCommentRating} />
              </div>
              <div className="flex gap-2">
                <Input placeholder="Add a comment…" value={commentText} onChange={(e) => setCommentText(e.target.value)} aria-label="Comment" />
                <Button type="submit" disabled={!commentText.trim() || addComment.isPending}>{addComment.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Add'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
          <DialogContent className="max-w-3xl p-2">
            <DialogHeader className="sr-only"><DialogTitle>Photo</DialogTitle><DialogDescription>Recipe photo</DialogDescription></DialogHeader>
            {lightbox && <img src={recipeAssetUrl(d.filename, lightbox.id)} alt="" className="max-h-[75vh] w-full rounded-lg object-contain" />}
            {lightbox && (
              <DialogFooter className="flex-row justify-end gap-2 px-2 pb-2">
                {lightbox.id !== coverId && <Button variant="outline" size="sm" onClick={() => { setMeta({ image: lightbox.filename, thumbnail: lightbox.filename }); setLightbox(null) }}><Star className="size-4" /> Use as cover</Button>}
                <Button variant="destructive" size="sm" onClick={() => removePhoto.mutate(lightbox.id)} disabled={removePhoto.isPending}><Trash2 className="size-4" /> Delete photo</Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Run “{d.metadata.title || 'this recipe'}”?</DialogTitle>
              <DialogDescription>The grill will start up and follow the {d.recipe.steps.length} steps automatically. {d.recipe.steps.some((s) => s.mode === 'Hold') ? `First hold: ${fmtTemp(d.recipe.steps.find((s) => s.mode === 'Hold')!.hold_temp, units)}.` : ''}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRun(false)}>Cancel</Button>
              <Button onClick={() => { setConfirmRun(false); run('recipe.start', { filename: d.filename }, { success: 'Recipe started' }) }}>Start</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Recipes</h1>
          <p className="text-sm text-muted-foreground">Programs the grill can run on its own: start, smoke, hold to a probe temperature, shut down.</p>
        </div>
        <div className="flex gap-2">
          <input ref={importInput} type="file" accept=".pfrecipe,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importRecipe.mutate(f) }} />
          <Button variant="outline" size="sm" onClick={() => importInput.current?.click()} disabled={importRecipe.isPending}>{importRecipe.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Import</Button>
          <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}><Plus className="size-4" /> New</Button>
        </div>
      </div>
      {running && state && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
            <span>A recipe is running{state.recipe.paused ? ' and waiting on a paused step' : ''}.</span>
            {state.recipe.paused && <Button size="sm" onClick={() => run('recipe.continue')}><FastForward className="size-4" /> Continue</Button>}
          </CardContent>
        </Card>
      )}
      {!list.data ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : list.data.recipes.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No recipes yet.</CardContent></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {list.data.recipes.map((r, i) => (
            <button key={r.filename} type="button" onClick={() => setSelected(r.filename)} className={`flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted ${i > 0 ? 'border-t' : ''}`}>
              {assetIdOf(r.thumbnail) ? <img src={recipeAssetUrl(r.filename, assetIdOf(r.thumbnail)!, true)} alt="" className="size-10 rounded-lg object-cover" /> : <BookOpen className="size-5 text-ember" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                  {r.comment_rating != null && <span className="flex items-center gap-0.5 text-ember"><Star className="size-3 fill-ember" /> {r.comment_rating}</span>}
                  <span className="truncate">{r.description || (r.cook_time ? `${r.cook_time} min` : '')}{r.error ? ' · unreadable' : ''}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
