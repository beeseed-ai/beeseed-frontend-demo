import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sdkRoot = path.resolve(__dirname, '../../../beeseed-sdk')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@beeseed/beeseed-sdk/tailwind.css': path.resolve(sdkRoot, 'tailwind.css'),
      '@beeseed/beeseed-sdk': path.resolve(sdkRoot, 'src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'app-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
