import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecipesPage } from './RecipesPage'
import { useGrill } from '@/stores/grill'
import { makeState } from '@/test/fixtures'

const recipe = {
  filename: 'r.pfrecipe',
  metadata: { title: 'Ribs', description: '', author: 'Me', rating: 4, prep_time: 15, cook_time: 300, difficulty: 'Medium', units: 'F', food_probes: 2, image: 'c1.jpg', thumbnail: 'c1.jpg' },
  recipe: { ingredients: [{ name: 'Ribs', quantity: '2 racks', assets: ['p1'] }], instructions: [], steps: [] },
  assets: [
    { id: 'c1', filename: 'c1.jpg', type: 'jpg' },
    { id: 'p1', filename: 'p1.jpg', type: 'jpg' },
  ],
}

function fetchFor(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    return { ok: !!key, status: key ? 200 : 404, text: async () => JSON.stringify(key ? routes[key] : { detail: 'nope' }) }
  })
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RecipesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useGrill.setState({ state: makeState({ mode: 'Stop' }), command: vi.fn() } as never)
})

describe('RecipesPage', () => {
  it('lists recipes with cover thumbnails and offers import', async () => {
    vi.stubGlobal('fetch', fetchFor({ '/api/v1/recipes': { recipes: [{ filename: 'r.pfrecipe', title: 'Ribs', description: 'Low and slow', thumbnail: 'c1.jpg' }] } }))
    mount()
    expect(await screen.findByText('Ribs')).toBeInTheDocument()
    expect(screen.getByText('Import')).toBeInTheDocument()
    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toContain('/api/v1/recipes/r.pfrecipe/assets/c1?thumb=true')
  })

  it('opens the editor with metadata, cover and row photos', async () => {
    vi.stubGlobal('fetch', fetchFor({ '/api/v1/recipes/r.pfrecipe': recipe, '/api/v1/recipes': { recipes: [{ filename: 'r.pfrecipe', title: 'Ribs', description: '' }] } }))
    mount()
    fireEvent.click(await screen.findByText('Ribs'))
    await waitFor(() => expect(screen.getByDisplayValue('Me')).toBeInTheDocument())
    expect(screen.getByDisplayValue('300')).toBeInTheDocument()
    expect(screen.getByLabelText('4 stars')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Open cover photo')).toBeInTheDocument()
    expect(screen.getByLabelText('Download recipe')).toHaveAttribute('href', expect.stringContaining('/api/v1/recipes/r.pfrecipe/download'))
    const thumbs = Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(thumbs.some((s) => s?.includes('/assets/p1?thumb=true'))).toBe(true)
  })
})
