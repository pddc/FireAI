import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CookDetailPage, assetIdOf } from './CookDetailPage'
import { useGrill } from '@/stores/grill'
import type { CookDoc } from '@/types/state'

const doc: CookDoc = {
  id: 'c.pifire',
  filename: 'c.pifire',
  metadata: { title: 'Brisket', starttime: 1_700_000_000_000, units: 'F', thumbnail: 'a1.jpg' },
  rows: [],
  events: [],
  comments: [{ id: 'n1', text: 'Great bark', date: '2026-09-16', time: '14:30', assets: ['a1'] }],
  assets: [{ id: 'a1', filename: 'a1.jpg', type: 'jpg' }],
}

const source = {
  kind: 'local' as const,
  getCook: vi.fn(async () => doc),
  updateCook: vi.fn(async () => undefined),
  addCookComment: vi.fn(async () => undefined),
  deleteCook: vi.fn(async () => undefined),
  cookAssetUrl: (id: string, aid: string, thumb?: boolean) => `/asset/${id}/${aid}${thumb ? '?t' : ''}`,
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cooks/c.pifire']}>
        <Routes>
          <Route path="/cooks/:cookId" element={<CookDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useGrill.setState({ source: source as never })
})

describe('assetIdOf', () => {
  it('strips the extension PiFire stores in metadata.thumbnail', () => {
    expect(assetIdOf('abc.jpg')).toBe('abc')
    expect(assetIdOf('abc')).toBe('abc')
    expect(assetIdOf('')).toBeNull()
  })
})

describe('CookDetailPage', () => {
  it('shows notes with their photos and marks the cover', async () => {
    mount()
    expect(await screen.findByText('Great bark')).toBeInTheDocument()
    const imgs = Array.from(document.querySelectorAll('img'))
    expect(imgs.some((i) => i.getAttribute('src') === '/asset/c.pifire/a1?t')).toBe(true)
    expect(screen.getByLabelText('Add photo')).toBeInTheDocument()
    expect(screen.getByLabelText('Download cook file')).toHaveAttribute('href', expect.stringContaining('/api/v1/cooks/c.pifire/download'))
  })

  it('edits a note through PUT /comments/{id}', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ comments: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    await screen.findByText('Great bark')
    fireEvent.click(screen.getByLabelText('Edit note'))
    const input = screen.getByDisplayValue('Great bark')
    fireEvent.change(input, { target: { value: 'Even better bark' } })
    fireEvent.click(screen.getByLabelText('Save note'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/v1/cooks/c.pifire/comments/n1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Even better bark' })
  })

  it('uploads a photo as multipart without a JSON content type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ id: 'a2', filename: 'a2.jpg', type: 'jpg' }) }))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    await screen.findByText('Great bark')
    const input = screen.getByTestId('photo-input') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/v1/cooks/c.pifire/assets?thumbnail=false')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Headers).has('Content-Type')).toBe(false)
  })
})
