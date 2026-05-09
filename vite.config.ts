/**
 * Vite config for building the main SDK as a minified ESM library.
 *
 * Output: dist/index.mjs (minified ESM)
 * Types are generated separately by dts-bundle-generator → dist/index.d.ts
 * All dependencies are externalized (consumers install them via npm).
 */

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      external: [
        'zod',
        '@breezystack/lamejs',
        '@ricky0123/vad-web',
        'core-js',
      ],
    },
  },
});
