import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SetupWizardPage } from './SetupWizardPage'
import catalogue from '@/test/fixtures/hardware.json'

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SetupWizardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SetupWizardPage', () => {
  it('walks board → display → sensor → probes → review and PUTs the hardware selection', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(init?.method === 'PUT' ? { restart_required: true, reboot_required: false } : catalogue),
    }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    fireEvent.click(await screen.findByText('Get started'))
    expect(await screen.findByText('Controller board')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Display')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Pellet level sensor')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Temperature units')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Review')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save & apply'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/api/v1/hardware') && i?.method === 'PUT')).toBe(true))
    expect(await screen.findByText('Restart control now')).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')![1] as RequestInit
    expect(JSON.parse(put.body as string)).toMatchObject({ units: catalogue.current.units, grillplatform: { id: catalogue.current.grillplatform } })
  })

  it('can be skipped', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => JSON.stringify(String(url).includes('dismiss') ? { ok: true } : catalogue) }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    fireEvent.click(await screen.findByText("Skip, I'll configure it myself"))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/hardware/wizard/dismiss'))).toBe(true))
  })
})
