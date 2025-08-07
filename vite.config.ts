import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import path from 'path'
import { defineConfig } from 'vite'

// Read package.json to get the app name
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_NAME__: JSON.stringify(packageJson.name),
  },
  build: {
    outDir: 'dist',
  },
  server: {
    open: true,
    watch: {
      ignored: [
        '**/server/**',
        '**/docs/**',
        '**/node_modules/**',
        '**/.git/**'
      ]
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    }
  }
})
