import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4300',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node test/fixtures/server.ts',
    url: 'http://127.0.0.1:4300/healthz',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
