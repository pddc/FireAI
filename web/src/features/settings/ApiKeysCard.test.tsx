import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiKeysCard } from './ApiKeysCard'

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><ApiKeysCard /></QueryClientProvider>)
}

describe('ApiKeysCard', () => {
  it('lists keys, creates one and shows the secret once', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: init?.method === 'POST' ? 201 : 200,
      text: async () =>
        JSON.stringify(init?.method === 'POST'
          ? { key: 'fireai_secret123', id: 'k2', name: 'Node-RED', role: 'operator', created: '2026-09-16 10:00', last_used: null }
          : { keys: [{ id: 'k1', name: 'Home Assistant', role: 'viewer', created: '2026-09-01 08:00', last_used: '2026-09-15' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    expect(await screen.findByText('Home Assistant')).toBeInTheDocument()
    expect(screen.getByText(/viewer · created 2026-09-01/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'Node-RED' } })
    fireEvent.click(screen.getByText('Create key'))
    await waitFor(() => expect(screen.getByTestId('fresh-key')).toHaveTextContent('fireai_secret123'))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Node-RED', role: 'operator' })
  })
})
