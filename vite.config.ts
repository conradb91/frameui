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
              entry: { index: path.join(root, 'src/main/index.ts'), indexWorker: path.join(root, 'src/main/indexer/indexWorker.ts') },
              formats: ['cjs'],
              fileName: (format, entryName) => `${entryName}.${format === 'cjs' ? 'cjs' : 'mjs'}`,
            },
            rollupOptions: {
              // Source parsers are Node-side dependencies and must remain
              // external. In particular, bundling @vue/compiler-sfc pulls
              // its optional consolidate adapters into the entry chunk,
              // turning packages such as `velocityjs` into eager startup
              // requirements and preventing Electron from opening at all.
              external: ['electron', 'chokidar', 'ts-morph', 'php-parser', 'svelte/compiler', '@vue/compiler-sfc', '@vue/compiler-core'],
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xyflow')) return 'flow-canvas'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor'
          return undefined
        },
      },
    },
  },
})
