import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SchemaGroupCard, type SchemaField } from '@/features/settings/SchemaForm'

const f = (over: Partial<SchemaField> & { path: string; label: string }): SchemaField => ({
  widget: 'text', help: '', min: null, max: null, step: null, unit: '', options: null, visible_if: null, advanced: false, restart: null, ...over,
})
const ALL: Record<string, SchemaField> = {
  toggle: f({ path: 'a.t', label: 'Toggle', widget: 'toggle' }),
  number: f({ path: 'a.n', label: 'Number', widget: 'number', min: 0, max: 10 }),
  select: f({ path: 'a.s', label: 'Select', widget: 'select', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }),
  slider: f({ path: 'a.sl', label: 'Slider', widget: 'slider', min: 0, max: 9, step: 1 }),
  list: f({ path: 'a.l', label: 'List', widget: 'list' }),
  password: f({ path: 'a.p', label: 'Password', widget: 'password' }),
}

/** Dev-only: /debug?w=select renders a single widget so render loops can be bisected. */
export function DebugWidgets() {
  const [sp] = useSearchParams()
  const w = sp.get('w') ?? 'toggle'
  const [saved, setSaved] = useState<unknown>(null)
  const values = { a: { t: false, n: 3, s: 'x', sl: 2, l: [1, 2], p: '***' } }
  return (
    <div className="p-6 space-y-4">
      <SchemaGroupCard group={{ title: w, help: '', fields: [ALL[w]] }} values={values} units="F" showAdvanced onSave={async (p) => setSaved(p)} />
      <pre className="text-xs">{JSON.stringify(saved)}</pre>
    </div>
  )
}
