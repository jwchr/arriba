import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE is set by the GitHub Pages workflow ("/arriba/"); local dev and tests use "/".
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
