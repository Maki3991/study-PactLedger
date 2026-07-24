import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        kaleidox: fileURLToPath(new URL('./kaleidox.html', import.meta.url)),
        landing: fileURLToPath(new URL('./landing.html', import.meta.url)),
        poolmate: fileURLToPath(new URL('./poolmate.html', import.meta.url)),
        'knowledge-base': fileURLToPath(new URL('./knowledge-base.html', import.meta.url)),
      },
    },
  },
})
