import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
