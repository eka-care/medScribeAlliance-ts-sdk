/**
 * Vite config for building the SharedWorker as a self-contained IIFE bundle.
 *
 * The worker needs to be a single file with zero import statements —
 * classic SharedWorker scripts can't use ES module imports.
 *
 * This bundles: shared-worker.ts + mp3-encoder.ts + @breezystack/lamejs
 * into dist/worker.bundle.js (minified IIFE).
 *
 * Usage: vite build --config vite.worker.config.ts
 */

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/worker/shared-worker.ts'),
      name: 'MedScribeWorker',
      formats: ['iife'],
      fileName: () => 'worker.bundle.js',
    },
    outDir: 'dist',
    emptyOutDir: false, // Don't clear dist — tsc already put files there
    minify: true,
    rollupOptions: {},
  },
});
