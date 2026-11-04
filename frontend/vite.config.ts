import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig(({ command }) => ({
  // HTTP production builds expose only UI assets; scenario/PDF bundles stay on the server.
  publicDir: command === 'serve' ? 'public' : false,
  plugins: [react(), {
    name: 'participant-ui-assets',
    apply: 'build',
    generateBundle() {
      const visit = (directory: string, prefix = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (!prefix && entry.name === 'materials') continue;
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          const path = join(directory, entry.name);
          if (entry.isDirectory()) visit(path, relative);
          else if (entry.isFile()) this.emitFile({ type: 'asset', fileName: relative, source: readFileSync(path) });
        }
      };
      visit(join(import.meta.dirname, 'public'));
    },
  }],
  base: './',
  build: { rollupOptions: { input: { participant: join(import.meta.dirname, 'index.html'), admin: join(import.meta.dirname, 'admin.html') } } },
  server: { fs: { strict: true }, proxy: { '/api': { target: process.env.FCM_API_TARGET ?? 'http://127.0.0.1:8000', changeOrigin: false } } },
}));
