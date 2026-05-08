import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the SDK from local source so we don't need to npm publish first
      'med-scribe-alliance-ts-sdk': path.resolve(__dirname, '../../src'),
    },
  },
  server: {
    strictPort: true,
    allowedHosts: ['af2bdc3e7766.ngrok-free.app', 'sanika.eka.care'],
  },
});
