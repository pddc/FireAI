import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { renderNotes } from './WhatsNewDialog'

describe('renderNotes', () => {
  it('renders headings, bullets, bold and code from the release notes subset', () => {
    const { container } = render(<div>{renderNotes('# FireAI 2.0.0\n\n## New\n\n- **New app** for phones\n- run `scripts/simulate.py`\n\nPlain paragraph.')}</div>)
    expect(container.querySelector('h3')?.textContent).toBe('New')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('strong')?.textContent).toBe('New app')
    expect(container.querySelector('code')?.textContent).toBe('scripts/simulate.py')
    expect(container.textContent).toContain('Plain paragraph.')
    expect(container.textContent).not.toContain('FireAI 2.0.0')
  })
})
