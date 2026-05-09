import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  plugins: [mkcert()],
  server: { host: '0.0.0.0', https: true },
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  base: './',
});
