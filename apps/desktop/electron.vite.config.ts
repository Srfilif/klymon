import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const workspacePackages = [
  '@klymon/shared-types',
  '@klymon/core',
  '@klymon/database',
  '@klymon/download-manager',
  '@klymon/authentication',
  '@klymon/version-manager',
  '@klymon/java-manager',
  '@klymon/instance-manager',
  '@klymon/modloader-manager',
  '@klymon/mod-manager',
  '@klymon/skin-manager',
  '@klymon/performance-manager',
  '@klymon/music-manager',
  '@klymon/progression',
];

const aliases = [
  {
    find: /^@klymon\/shared-types\/ipc$/,
    replacement: resolve(__dirname, '../../packages/shared-types/src/ipc.ts'),
  },
  {
    find: /^@klymon\/shared-types\/models$/,
    replacement: resolve(__dirname, '../../packages/shared-types/src/models.ts'),
  },
  ...workspacePackages.map((name) => ({
    find: new RegExp(`^${name.replace('/', '\\/')}$`),
    replacement: resolve(__dirname, `../../packages/${name.replace('@klymon/', '')}/src/index.ts`),
  })),
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: aliases },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    server: {
      port: 5199,
      strictPort: true,
    },
  },
});
