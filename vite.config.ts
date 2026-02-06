// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ✅ route serveur dev pour upload Synology (évite CORS côté navigateur)
import { handleUploadToSynology } from './server/uploadToSynology'

export default defineConfig({
  plugins: [
    react(),

    // ✅ Middleware dev : POST /api/upload-pdf
    {
      name: 'limgpt-upload-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/upload-pdf' && req.method === 'POST') {
            handleUploadToSynology(req, res)
            return
          }
          next()
        })
      },
    },

    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'LIM',
        short_name: 'LIM',
        description: 'Affichage dynamique du LIM pour conducteurs TGV',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          {
            src: '/vite.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    host: true,
    port: 5199,
    strictPort: true,
  },
})
