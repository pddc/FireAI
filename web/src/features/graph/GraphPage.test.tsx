import { describe, expect, it } from 'vitest'
import { historyToCsv } from './GraphPage'
import { annotationsFromEvents } from '@/components/chart/TempChart'
import { makeState } from '@/test/fixtures'

describe('graph helpers', () => {
  it('turns events into mode-change annotations', () => {
    const ann = annotationsFromEvents([
      { date: '2026-09-16', time: '10:00:00', message: 'Startup Mode started.' },
      { date: '2026-09-16', time: '10:04:00', message: 'Smoke Mode started.' },
      { date: '2026-09-16', time: '10:05:00', message: 'Hopper Level Checked @ 100%' },
    ])
    expect(ann.map((a) => a.label)).toEqual(['Startup', 'Smoke'])
    expect(ann[1].t - ann[0].t).toBe(240)
  })

  it('exports one column per probe with names from the probe map', () => {
    const state = makeState()
    const csv = historyToCsv([{ T: Date.UTC(2026, 8, 16, 10, 0, 0), P: { Grill: 225 }, F: { Probe1: 140, Probe2: 0 }, PSP: 225, NT: { Probe1: 165, Probe2: 0 }, AUX: {} }], state)
    const [header, row] = csv.trim().split('\n')
    expect(header).toContain('"Grill","Setpoint","Probe-1"')
    expect(row).toBe('"2026-09-16T10:00:00.000Z","225","225","140","0","165","0"')
  })
})
