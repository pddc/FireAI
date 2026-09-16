import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Loader2, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { unitLabel } from '@/lib/format'
import type { Units } from '@/types/state'

export interface SchemaField {
  path: string
  label: string
  widget: 'toggle' | 'number' | 'temp' | 'text' | 'password' | 'select' | 'slider' | 'list' | 'color'
  help: string
  min: number | null
  max: number | null
  step: number | null
  unit: string
  options: { value: string | number | boolean; label: string }[] | null
  visible_if: Record<string, unknown[]> | null
  advanced: boolean
  restart: string | null
}
export interface SchemaGroup {
  title: string
  help: string
  fields: SchemaField[]
}
export interface SchemaSection {
  id: string
  title: string
  icon: string
  description: string
  groups: SchemaGroup[]
  local_only: boolean
}
export interface SettingsSchema {
  sections: SchemaSection[]
  units: Units
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.')
  let node = obj
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}
    node = node[p] as Record<string, unknown>
  }
  node[parts[parts.length - 1]] = value
  return obj
}

/** Build a nested patch document from dotted-path edits. */
export function buildPatch(edits: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(edits)) setPath(out, path, value)
  return out
}

export function isVisible(field: SchemaField, values: Record<string, unknown>, edits: Record<string, unknown>): boolean {
  if (!field.visible_if) return true
  return Object.entries(field.visible_if).every(([path, allowed]) => {
    const v = path in edits ? edits[path] : getPath(values, path)
    return allowed.some((a) => a === v || String(a) === String(v))
  })
}

interface FieldProps {
  field: SchemaField
  value: unknown
  onChange: (v: unknown) => void
  units: Units
  dirty: boolean
}

function FieldControl({ field, value, onChange, units, dirty }: FieldProps) {
  const [show, setShow] = useState(false)
  const id = `f-${field.path.replace(/\./g, '-')}`
  const unit = field.widget === 'temp' ? unitLabel(units) : field.unit
  switch (field.widget) {
    case 'toggle':
      return <Switch id={id} checked={!!value} onCheckedChange={(c) => onChange(c)} />
    case 'select':
      return (
        <Select
          value={String(value ?? '')}
          onValueChange={(v) => onChange(coerceOption(field, String(v ?? '')))}
          items={(field.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))}
        >
          <SelectTrigger id={id} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'slider':
      return (
        <div className="flex w-full items-center gap-3 sm:w-72">
          <Slider min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={[Number(value ?? field.min ?? 0)]} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)} />
          <span className="w-14 text-right text-sm tabular">
            {String(value ?? '')}
            {unit}
          </span>
        </div>
      )
    case 'number':
    case 'temp':
      return (
        <div className="relative w-full sm:w-40">
          <Input id={id} type="number" inputMode="decimal" min={field.min ?? undefined} max={field.max ?? undefined} step={field.step ?? 'any'} value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={cn('pr-10 tabular', dirty && 'border-ember/60')} />
          {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>}
        </div>
      )
    case 'password':
      return (
        <div className="relative w-full sm:w-72">
          <Input id={id} type={show ? 'text' : 'password'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={value === '***' ? 'saved' : ''} className={cn('pr-9', dirty && 'border-ember/60')} />
          <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground" onClick={() => setShow(!show)} aria-label="Show">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      )
    case 'list':
      return <ListEditor value={Array.isArray(value) ? (value as unknown[]) : []} onChange={onChange} />
    case 'color':
      return <Input id={id} type="color" value={String(value ?? '#000000')} onChange={(e) => onChange(e.target.value)} className="w-16" />
    default:
      return <Input id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={cn('w-full sm:w-72', dirty && 'border-ember/60')} />
  }
}

function coerceOption(field: SchemaField, v: string) {
  const match = (field.options ?? []).find((o) => String(o.value) === v)
  return match ? match.value : v
}

function ListEditor({ value, onChange }: { value: unknown[]; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => setText(value.join('\n')), [value])
  const commit = () => {
    const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
    const numeric = items.every((s) => /^-?\d+(\.\d+)?$/.test(s))
    onChange(numeric ? items.map(Number) : items)
  }
  return <textarea className="min-h-24 w-full rounded-lg border bg-background p-2 font-mono text-sm sm:w-96" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
}

interface GroupProps {
  group: SchemaGroup
  values: Record<string, unknown>
  units: Units
  showAdvanced: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}

export function SchemaGroupCard({ group, values, units, showAdvanced, onSave }: GroupProps) {
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const visibleFields = group.fields.filter((f) => (showAdvanced || !f.advanced) && isVisible(f, values, edits))
  if (visibleFields.length === 0) return null
  const dirty = Object.keys(edits).length > 0
  const save = async () => {
    setSaving(true)
    try {
      await onSave(buildPatch(edits))
      setEdits({})
      const needsRestart = group.fields.filter((f) => f.path in edits && f.restart).map((f) => f.restart)
      toast.success(needsRestart.length ? `Saved — restart the ${needsRestart[0]} process to apply` : 'Saved')
    } catch (e) {
      toast.error((e as Error).message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{group.title}</CardTitle>
        {group.help && <CardDescription>{group.help}</CardDescription>}
      </CardHeader>
      <CardContent className="divide-y">
        {visibleFields.map((f) => {
          const current = f.path in edits ? edits[f.path] : getPath(values, f.path)
          return (
            <div key={f.path} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0 sm:max-w-md">
                <Label htmlFor={`f-${f.path.replace(/\./g, '-')}`} className="text-sm">
                  {f.label}
                </Label>
                {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
              </div>
              <div className="shrink-0">
                <FieldControl field={f} value={current} units={units} dirty={f.path in edits} onChange={(v) => setEdits((e) => ({ ...e, [f.path]: v }))} />
              </div>
            </div>
          )
        })}
        {dirty && (
          <div className="flex items-center justify-end gap-2 pt-3">
            <Button variant="ghost" size="sm" onClick={() => setEdits({})} disabled={saving}>
              <RotateCcw className="size-4" /> Discard
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface SectionProps {
  section: SchemaSection
  values: Record<string, unknown>
  units: Units
  onSave: (patch: Record<string, unknown>) => Promise<void>
}

export function SchemaSectionForm({ section, values, units, onSave }: SectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const hasAdvanced = useMemo(() => section.groups.some((g) => g.fields.some((f) => f.advanced)), [section])
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{section.title}</h1>
          <p className="text-sm text-muted-foreground">{section.description}</p>
        </div>
        {hasAdvanced && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Advanced <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
          </label>
        )}
      </div>
      {section.groups.map((g) => (
        <SchemaGroupCard key={g.title} group={g} values={values} units={units} showAdvanced={showAdvanced} onSave={onSave} />
      ))}
    </div>
  )
}
