import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: process.env.VERCEL ? false : 'public',
  build: {
    outDir: process.env.VERCEL ? 'public' : 'dist',
    emptyOutDir: true,
  },
});
