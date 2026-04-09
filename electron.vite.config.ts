import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      lib: { entry: resolve(__dirname, 'src/main/main.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/preload/main.preload.ts'),
          region: resolve(__dirname, 'src/preload/region.preload.ts'),
          annotation: resolve(__dirname, 'src/preload/annotation.preload.ts'),
          countdown: resolve(__dirname, 'src/preload/countdown.preload.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/renderer/index.html'),
          region: resolve(__dirname, 'src/renderer/region.html'),
          annotation: resolve(__dirname, 'src/renderer/annotation.html'),
          countdown: resolve(__dirname, 'src/renderer/countdown.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    }
  }
});
