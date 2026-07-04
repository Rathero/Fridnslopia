import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: 'es2022', outDir: 'dist' },
  // rapier2d-compat inlines its WASM as base64, so no special asset handling
  // is required. Keep the dependency un-optimized so its init works cleanly.
  optimizeDeps: { exclude: ['@dimforge/rapier2d-compat'] },
});
