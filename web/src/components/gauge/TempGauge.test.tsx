import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TempGauge } from './TempGauge'

describe('TempGauge', () => {
  it('renders the track only when value is null', () => {
    const { container } = render(<TempGauge value={null} min={0} max={600} />)
    expect(container.querySelectorAll('path').length).toBe(1)
  })
  it('renders a filled arc and target tick', () => {
    const { container } = render(<TempGauge value={225} min={0} max={600} target={250} />)
    expect(container.querySelectorAll('path').length).toBe(2)
    expect(container.querySelectorAll('line').length).toBe(1)
  })
  it('clamps values outside the range without throwing', () => {
    const { container } = render(<TempGauge value={9999} min={0} max={600} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
