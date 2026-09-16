import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronLeft, Loader2, Play, Plus, Save, Trash2, ArrowUp, ArrowDown, FastForward } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { NativeSelect } from '@/components/ui/native-select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, get, post } from '@/lib/api'
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
interface Recipe {
  filename: string
  metadata: { title: string; description: string; author: string; rating: number; prep_time: number; cook_time: number; difficulty: string; units: string; food_probes: number }
  recipe: { ingredients: { name: string; quantity: string }[]; instructions: { text: string; step: number }[]; steps: Step[] }
}
interface Summary {
  filename: string
  title: string
  description: string
  cook_time: number
  difficulty: string
  error?: string
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
  const del = useMutation({
    mutationFn: (fn: string) => api(`/api/v1/recipes/${encodeURIComponent(fn)}`, { method: 'DELETE' }),
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ['recipes'] }) },
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
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => setSelected(null)}><ChevronLeft className="size-4" /></Button>
          <div className="flex-1 space-y-1">
            <Input className="text-lg font-semibold" value={d.metadata.title} placeholder="Recipe title" onChange={(e) => setDraft({ ...d, metadata: { ...d.metadata, title: e.target.value } })} />
            <Input value={d.metadata.description} placeholder="Short description" onChange={(e) => setDraft({ ...d, metadata: { ...d.metadata, description: e.target.value } })} />
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => del.mutate(d.filename)}><Trash2 className="size-4 text-destructive" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirmRun(true)} disabled={running || dirty}><Play className="size-4" /> Run recipe</Button>
          {dirty && <Button variant="outline" onClick={() => save.mutate(d)} disabled={save.isPending}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>}
          {running && <Button variant="outline" onClick={() => run('recipe.continue', undefined, { success: 'Continuing' })}><FastForward className="size-4" /> Continue paused step</Button>}
        </div>

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
              <div key={i} className="flex gap-2">
                <Input className="w-28" placeholder="Qty" value={ing.quantity} onChange={(e) => setDraft({ ...d, recipe: { ...d.recipe, ingredients: d.recipe.ingredients.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) } })} />
                <Input placeholder="Ingredient" value={ing.name} onChange={(e) => setDraft({ ...d, recipe: { ...d.recipe, ingredients: d.recipe.ingredients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } })} />
                <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, ingredients: d.recipe.ingredients.filter((_, j) => j !== i) } })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, ingredients: [...d.recipe.ingredients, { name: '', quantity: '' }] } })}><Plus className="size-4" /> Add ingredient</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Instructions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.recipe.instructions.map((ins, i) => (
              <div key={i} className="flex gap-2">
                <span className="mt-2 w-6 text-sm text-muted-foreground">{i + 1}.</span>
                <textarea className="min-h-16 flex-1 rounded-lg border bg-background p-2 text-sm" value={ins.text} onChange={(e) => setDraft({ ...d, recipe: { ...d.recipe, instructions: d.recipe.instructions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) } })} />
                <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, instructions: d.recipe.instructions.filter((_, j) => j !== i) } })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...d, recipe: { ...d.recipe, instructions: [...d.recipe.instructions, { text: '', step: 0 }] } })}><Plus className="size-4" /> Add instruction</Button>
          </CardContent>
        </Card>

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
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}><Plus className="size-4" /> New</Button>
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
              <BookOpen className="size-5 text-ember" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="truncate text-xs text-muted-foreground">{r.description || (r.cook_time ? `${r.cook_time} min` : '')}{r.error ? ' · unreadable' : ''}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
