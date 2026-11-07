import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const host = '10.126.179.2';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host,
    port: 5173,
    strictPort: true,
    ws: {
      host,
      clientPort: 5173,
      protocol: 'ws',
    },
    watch: {
      ignored: ['**/src-tauri/**', '**/.cache/**', '**/artifacts/**'],
    },
  },
  preview: {
    host,
    port: 4174,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG === 'true' ? false : 'oxc',
    sourcemap: process.env.TAURI_ENV_DEBUG === 'true',
  },
});
