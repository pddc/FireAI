import { defineConfig, devices } from '@playwright/test'

// E2E against the simulator: `python scripts/simulate.py --with-server --speed 10` must be
// running on :8080 (auth disabled) and the app served on :5173 (dev) or :4173 (preview).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  reporter: process.env.CI ? 'github' : 'list',
})
