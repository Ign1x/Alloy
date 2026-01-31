import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    proxy: {
      // Forward rspc calls to the control plane during local dev.
      '/rspc': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Auth endpoints are outside /rspc.
      '/auth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
