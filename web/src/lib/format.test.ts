import { describe, expect, it } from 'vitest'
import { fmtClock, fmtDuration, fmtTemp, unitLabel } from './format'

describe('fmtTemp', () => {
  it('formats fahrenheit as integers with degree sign', () => {
    expect(fmtTemp(225.4, 'F')).toBe('225°')
    expect(fmtTemp(225, 'F', { unit: false })).toBe('225')
  })
  it('formats celsius with one decimal', () => {
    expect(fmtTemp(107.25, 'C')).toBe('107.3°')
  })
  it('renders placeholders for missing values', () => {
    expect(fmtTemp(null, 'F')).toBe('--')
    expect(fmtTemp(undefined, 'C')).toBe('--')
    expect(fmtTemp(NaN, 'F')).toBe('--')
  })
})

describe('durations', () => {
  it('fmtDuration picks the right granularity', () => {
    expect(fmtDuration(45)).toBe('45s')
    expect(fmtDuration(65)).toBe('1m 05s')
    expect(fmtDuration(3900)).toBe('1h 05m')
    expect(fmtDuration(-5)).toBe('0s')
  })
  it('fmtClock pads and drops hours when zero', () => {
    expect(fmtClock(9)).toBe('00:09')
    expect(fmtClock(3661)).toBe('1:01:01')
  })
  it('unitLabel', () => {
    expect(unitLabel('F')).toBe('°F')
    expect(unitLabel('C')).toBe('°C')
  })
})
