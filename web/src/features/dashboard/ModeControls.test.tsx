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

  it('steps the P-Mode while smoking', async () => {
    render(<ModeControls state={makeState({ mode: 'Smoke', p_mode: 2 })} />)
    expect(screen.getByTestId('pmode-value')).toHaveTextContent('2')
    fireEvent.click(screen.getByLabelText('Raise P-Mode'))
    await waitFor(() => expect(command).toHaveBeenCalledWith('pmode', { pmode: 3 }))
  })

  it('hides P-Mode while holding', () => {
    render(<ModeControls state={makeState({ mode: 'Hold', p_mode: 2 })} />)
    expect(screen.queryByTestId('pmode-value')).not.toBeInTheDocument()
  })

  it('offers re-ignite in error mode', () => {
    render(<ModeControls state={makeState({ mode: 'Error' })} />)
    expect(screen.getByText('Re-ignite')).toBeInTheDocument()
  })
})

describe('ModeControls gating', () => {
  it('disables controls when offline', () => {
    useGrill.setState({ command, status: 'offline' })
    render(<ModeControls state={makeState({ mode: 'Smoke' })} />)
    expect(screen.getByText('Smoke').closest('button')).toBeDisabled()
    expect(screen.getByText(/disabled while the grill is offline/)).toBeInTheDocument()
    useGrill.setState({ status: 'live' })
  })

  it('disables controls when remote control is off in cloud mode', () => {
    useGrill.setState({ command, status: 'live', source: { kind: 'cloud' } as never })
    render(<ModeControls state={makeState({ mode: 'Smoke', cloud_control: false })} />)
    expect(screen.getByText('Smoke').closest('button')).toBeDisabled()
    expect(screen.getByText(/Remote control is switched off/)).toBeInTheDocument()
    useGrill.setState({ source: null })
  })
})
