// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Configuration Vite – avec PWA (offline) + réseau local + port fixe
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'LIMGPT',
        short_name: 'LIMGPT',
        description: 'Affichage dynamique du LIM pour conducteurs TGV',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          {
            src: '/vite.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          }
        ]
      },
      devOptions: {
        enabled: true,        // <- ACTIVE le service worker aussi en dev
        navigateFallback: 'index.html'
      }
    })
  ],
  server: {
    host: true,              // <- écoute sur toutes les interfaces (iPad inclus)
    port: 5199,
    strictPort: true
  }
})
