import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SchemaSectionForm, buildPatch, isVisible, type SchemaField, type SchemaSection } from './SchemaForm'

const f = (over: Partial<SchemaField> & { path: string; label: string }): SchemaField => ({
  widget: 'text', help: '', min: null, max: null, step: null, unit: '', options: null, visible_if: null, advanced: false, restart: null, ...over,
})

const section: SchemaSection = {
  id: 'control', title: 'Control', icon: 'gauge', description: 'd', local_only: false,
  groups: [
    {
      title: 'Smoke mode', help: '',
      fields: [
        f({ path: 'cycle_data.PMode', label: 'P-Mode', widget: 'slider', min: 0, max: 9, step: 1 }),
        f({ path: 'cycle_data.SmokeOnCycleTime', label: 'Auger on time', widget: 'number', unit: 's', min: 5, max: 60 }),
        f({ path: 'cycle_data.LidOpenDetectEnabled', label: 'Detect lid open', widget: 'toggle' }),
        f({ path: 'cycle_data.LidOpenThreshold', label: 'Drop threshold', widget: 'slider', min: 5, max: 50, visible_if: { 'cycle_data.LidOpenDetectEnabled': [true] } }),
        f({ path: 'controller.selected', label: 'Controller', widget: 'select', options: [{ value: 'pid', label: 'PID' }, { value: 'pid_ac', label: 'PID AC' }] }),
        f({ path: 'globals.debug_mode', label: 'Debug', widget: 'toggle', advanced: true }),
        f({ path: 'startup.smartstart.temp_range_list', label: 'Thresholds', widget: 'list' }),
      ],
    },
  ],
}
const values = { cycle_data: { PMode: 2, SmokeOnCycleTime: 15, LidOpenDetectEnabled: false, LidOpenThreshold: 15 }, controller: { selected: 'pid' }, globals: { debug_mode: false }, startup: { smartstart: { temp_range_list: [60, 80] } } }

describe('SchemaForm helpers', () => {
  it('buildPatch nests dotted paths', () => {
    expect(buildPatch({ 'a.b.c': 1, 'a.d': 2, e: 3 })).toEqual({ a: { b: { c: 1 }, d: 2 }, e: 3 })
  })
  it('isVisible honours pending edits over saved values', () => {
    const field = section.groups[0].fields[3]
    expect(isVisible(field, values, {})).toBe(false)
    expect(isVisible(field, values, { 'cycle_data.LidOpenDetectEnabled': true })).toBe(true)
  })
})

describe('SchemaSectionForm', () => {
  it('renders fields, hides advanced and conditional ones', () => {
    render(<SchemaSectionForm section={section} values={values} units="F" onSave={vi.fn()} />)
    expect(screen.getByText('P-Mode')).toBeInTheDocument()
    expect(screen.queryByText('Debug')).not.toBeInTheDocument()
    expect(screen.queryByText('Drop threshold')).not.toBeInTheDocument()
  })

  it('shows the save bar only when dirty and sends a nested patch', async () => {
    const onSave = vi.fn(async () => {})
    render(<SchemaSectionForm section={section} values={values} units="F" onSave={onSave} />)
    expect(screen.queryByText('Save')).not.toBeInTheDocument()
    const input = screen.getByLabelText('Auger on time') as HTMLInputElement
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ cycle_data: { SmokeOnCycleTime: 20 } }))
    await waitFor(() => expect(screen.queryByText('Save')).not.toBeInTheDocument())
  })

  it('toggling a switch reveals dependent fields', () => {
    render(<SchemaSectionForm section={section} values={values} units="F" onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Detect lid open' }))
    expect(screen.getByText('Drop threshold')).toBeInTheDocument()
  })
})
