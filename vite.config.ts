import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5273,
    strictPort: true,
    open: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
