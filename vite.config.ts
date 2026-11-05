import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Version, commit and build time shown in the footer and Settings, so the rider can tell which Dale they have.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; }
})();

// BASE is set by the GitHub Pages workflow ("/dale/"); local dev and tests use "/".
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  // The map's worker is an ES module (maplibre-gl 6).
  worker: { format: 'es' },
  define: {
    __DALE_VERSION__: JSON.stringify(pkg.version),
    __DALE_COMMIT__: JSON.stringify(commit),
    __DALE_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
