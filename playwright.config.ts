import { defineConfig, devices } from '@playwright/test';

// PW_PORT gives each concurrent run (another session, a reviewer's worktree) its own preview server,
// so a run never tests another branch's build. Reuse only when asked (PW_REUSE=1), e.g. while
// `npm run preview` is already running on that port; otherwise a busy port fails the run.
const port = Number.parseInt(process.env.PW_PORT ?? '', 10) || 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, ...devices['Pixel 7'], timezoneId: 'America/New_York' },
  webServer: { command: `npx vite preview --port ${port} --strictPort`, port, reuseExistingServer: process.env.PW_REUSE === '1' },
});
