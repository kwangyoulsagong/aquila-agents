import { fileURLToPath, URL } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@design-system': fileURLToPath(new URL('./design-system', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5199, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  // Electron tests compile into dist-electron/ too (CommonJS) — run only the sources.
  test: { exclude: [...configDefaults.exclude, 'dist-electron/**'] },
});
