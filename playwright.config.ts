import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4173', ...devices['Pixel 7'], timezoneId: 'America/New_York' },
  webServer: { command: 'npm run preview', port: 4173, reuseExistingServer: true },
});
