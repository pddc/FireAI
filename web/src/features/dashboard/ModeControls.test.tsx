import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModeControls } from './ModeControls'
import { makeState } from '@/test/fixtures'
import { useGrill } from '@/stores/grill'

const command = vi.fn(async () => ({ result: 'OK' as const, message: 'ok', data: {} }))

beforeEach(() => {
  command.mockClear()
  useGrill.setState({ command })
})

describe('ModeControls', () => {
  it('shows start/prime/monitor/manual when stopped and sends mode.startup', async () => {
    render(<ModeControls state={makeState({ mode: 'Stop' })} />)
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('Monitor')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Start'))
    await waitFor(() => expect(command).toHaveBeenCalledWith('mode.startup', undefined))
  })

  it('shows cooking controls while smoking and asks before stopping', async () => {
    render(<ModeControls state={makeState({ mode: 'Smoke' })} />)
    expect(screen.getByText('Hold')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Stop'))
    expect(await screen.findByText('Stop the grill?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Stop now'))
    await waitFor(() => expect(command).toHaveBeenCalledWith('mode.stop', undefined))
  })

  it('shows the setpoint on the hold button while holding', () => {
    render(<ModeControls state={makeState({ mode: 'Hold', setpoint: 250 })} />)
    expect(screen.getByText('250°')).toBeInTheDocument()
    expect(screen.getByText('Smoke+')).toBeInTheDocument()
  })

  it('offers re-ignite in error mode', () => {
    render(<ModeControls state={makeState({ mode: 'Error' })} />)
    expect(screen.getByText('Re-ignite')).toBeInTheDocument()
  })
})
