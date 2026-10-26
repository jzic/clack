import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // allow importing ../shared/protocol.ts from outside the web root
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
  },
});
