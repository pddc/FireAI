import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HardwarePage } from './HardwarePage'
import catalogue from '@/test/fixtures/hardware.json'

describe('HardwarePage', () => {
  it('renders the catalogue without looping', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(catalogue) })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <HardwarePage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Controller board')).toBeInTheDocument())
    expect(screen.getByText('Save hardware configuration')).toBeInTheDocument()
  })
})
