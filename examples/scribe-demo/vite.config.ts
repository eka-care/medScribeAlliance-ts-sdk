import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // host: 'sanika.eka.care',
    // port: 5173, // optional
    strictPort: true,
    allowedHosts: ['af2bdc3e7766.ngrok-free.app', 'sanika.eka.care'],
  },
});
