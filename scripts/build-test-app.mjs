// Exercise the complete live path with intercepted synthetic data. Pages builds use `npm run build`.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, VITE_LIVE_API_URL: 'https://dale-live.test.workers.dev' },
});
process.exitCode = result.status ?? 1;
