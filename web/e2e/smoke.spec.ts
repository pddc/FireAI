import { test, expect } from '@playwright/test'

test.describe('FireAI smoke', () => {
  test('dashboard loads live state and controls a cook', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible()
    await expect(page.getByText(/Stopped|Smoking|Holding|Starting up|Shutting down|Monitoring/).first()).toBeVisible({ timeout: 15_000 })
    // A freshly upgraded grill shows the release notes once; dismiss them so they don't shadow the controls.
    const gotIt = page.getByRole('button', { name: 'Got it' })
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click()
    // Probe cards render gauges
    await expect(page.getByText('Grill', { exact: true })).toBeVisible()
    // Start a cook if stopped
    const start = page.getByRole('button', { name: 'Start' })
    if (await start.isVisible()) {
      await start.click()
      await expect(page.getByText('Starting up').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: /Hold/ })).toBeVisible()
    }
    // Stop with confirmation
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('button', { name: 'Stop now' }).click()
    await expect(page.getByText('Stopped').first()).toBeVisible({ timeout: 15_000 })
  })

  test('bottom tabs navigate on phones', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout only')
    await page.goto('/')
    await page.getByRole('link', { name: 'Graph' }).click()
    await expect(page.getByRole('heading', { name: 'Live graph' })).toBeVisible()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    // no horizontal scroll at phone width
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    expect(overflow).toBe(false)
  })

  test('settings section saves a value', async ({ page }) => {
    await page.goto('/settings/control')
    const input = page.getByLabel('Startup duration')
    await expect(input).toBeVisible()
    const original = await input.inputValue()
    await input.fill('250')
    await page.getByRole('button', { name: 'Save' }).first().click()
    await expect(page.getByText('Saved')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Startup duration')).toHaveValue('250')
    // restore
    await page.getByLabel('Startup duration').fill(original)
    await page.getByRole('button', { name: 'Save' }).first().click()
  })

  test('probes page lists devices and opens the module picker', async ({ page }) => {
    await page.goto('/settings/probes')
    await expect(page.getByRole('heading', { name: 'Probes' })).toBeVisible()
    await page.getByRole('button', { name: 'Add device' }).click()
    await expect(page.getByText(/ThermoMaven/).first()).toBeVisible()
  })

  test('manifest is present in production builds', async ({ page, baseURL }) => {
    test.skip(!!baseURL?.includes(':5173'), 'vite dev server does not inject the manifest')
    await page.goto('/')
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
  })
})
