import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

const root = __dirname

export default defineConfig({
  root: path.join(root, 'src/renderer'),
  publicDir: path.join(root, 'public'),
  resolve: {
    alias: {
      '@': path.join(root, 'src/renderer'),
      '@core': path.join(root, 'src/core'),
      '@shared': path.join(root, 'src/shared'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // Built as CJS on purpose, even though the rest of the project is
        // ESM ("type": "module") — Electron's main process has always
        // supported `require('electron')` reliably; ESM `import` of that
        // same built-in hits a real Node/Electron cjs-module-lexer
        // interop bug (confirmed while building this). A plain .cjs
        // extension overrides the package-level "type" for just this file.
        entry: path.join(root, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: path.join(root, 'dist-electron/main'),
            // The plugin builds main via Vite's `build.lib` mode, where the
            // OUTPUT FORMAT is decided by `lib.formats`, defaulted to
            // `['es']` here (package.json has "type":"module") — a
            // `rollupOptions.output.format` override alone is silently
            // ignored in lib mode. Vite's mergeConfig CONCATENATES the
            // `formats` array rather than replacing it, so adding 'cjs'
            // here produces `['es','cjs']`, not `['cjs']` alone — both
            // still get built. Rather than fight that, give each format
            // its own real extension so the (unused) ES copy doesn't
            // clobber the CJS one Electron actually loads.
            lib: {
              entry: path.join(root, 'src/main/index.ts'),
              formats: ['cjs'],
              fileName: (format) => (format === 'cjs' ? 'index.cjs' : 'index.mjs'),
            },
            rollupOptions: {
              external: ['electron', 'chokidar', 'ts-morph'],
            },
          },
          resolve: {
            alias: {
              '@core': path.join(root, 'src/core'),
              '@shared': path.join(root, 'src/shared'),
            },
          },
        },
      },
      preload: {
        input: path.join(root, 'src/preload/index.ts'),
        vite: {
          build: {
            outDir: path.join(root, 'dist-electron/preload'),
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'index.cjs',
              },
            },
          },
          resolve: {
            alias: {
              '@shared': path.join(root, 'src/shared'),
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
  },
})
