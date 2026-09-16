import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MaintenanceCard } from './MaintenanceCard'

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MaintenanceCard /></QueryClientProvider>)
}

describe('MaintenanceCard', () => {
  it('confirms before clearing a data set and calls DELETE', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    fireEvent.click(screen.getByLabelText('Clear Events'))
    expect(await screen.findByText('Clear events?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/v1/system/data/events')
    expect(init.method).toBe('DELETE')
  })

  it('factory reset needs the word RESET', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"ok":true,"restart_required":true}' }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    fireEvent.click(screen.getByText('Factory reset'))
    const go = await screen.findByRole('button', { name: 'Reset everything' })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type RESET to confirm'), { target: { value: 'RESET' } })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    expect(await screen.findByText('Reset complete')).toBeInTheDocument()
    expect(screen.getByText('Download logs').closest('a')).toHaveAttribute('href', expect.stringContaining('/api/v1/system/logs.zip'))
  })
})
