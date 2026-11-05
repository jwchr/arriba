import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Version, commit and build time shown in the footer and Settings, so the rider can tell which Dale they have.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// The last number counts releases: every GitHub build gets the next run number (0.3.157, 0.3.158…), so
// a newer Dale always shows a bigger number. A build on a laptop says "local".
const [major, minor] = pkg.version.split('.');
const version = process.env.GITHUB_RUN_NUMBER ? `${major}.${minor}.${process.env.GITHUB_RUN_NUMBER}` : `${major}.${minor}.local`;
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
    __DALE_VERSION__: JSON.stringify(version),
    __DALE_COMMIT__: JSON.stringify(commit),
    __DALE_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
