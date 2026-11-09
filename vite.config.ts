import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devEnvironment } from './scripts/dev-environment.ts';

export default defineConfig(({ command }) => {
  const development = command === 'serve' ? devEnvironment() : undefined;
  return {
    plugins: [react()],
    clearScreen: false,
    server: development && {
      host: development.host,
      port: development.port,
      strictPort: true,
      ws: {
        host: development.host,
        clientPort: development.port,
        protocol: 'ws',
      },
      watch: {
        ignored: ['**/src-tauri/**', '**/.cache/**', '**/artifacts/**'],
      },
    },
    preview: development && {
      host: development.host,
      port: development.previewPort,
      strictPort: true,
    },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
      target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: process.env.TAURI_ENV_DEBUG === 'true' ? false : 'oxc',
      sourcemap: process.env.TAURI_ENV_DEBUG === 'true',
    },
  };
});
