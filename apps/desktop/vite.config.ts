import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist-renderer',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        audioCapture: resolve(import.meta.dirname, 'audio-capture.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html'),
      },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
