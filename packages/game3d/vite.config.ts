import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5183, host: true },
  build: { target: 'es2022', outDir: 'dist' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
