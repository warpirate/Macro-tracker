import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Serves the `api/` handlers during `vite dev`.
 * In production Vercel runs these as Edge Functions; this plugin gives the
 * dev server the same routes without needing the Vercel CLI.
 */
function apiRoutes(mode: string): Plugin {
  return {
    name: 'local-api-routes',
    configureServer(server: ViteDevServer) {
      // Handlers read secrets off process.env, which Vite does not populate itself.
      Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) return next()

        const route = url.split('?')[0].replace(/^\/api\//, '')
        try {
          const mod = await server.ssrLoadModule(`/api/${route}.ts`)

          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)

          const request = new Request(`http://localhost${url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          })

          const response: Response = await mod.default(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    apiRoutes(mode),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Without this the dev server has no manifest to serve, so /manifest.webmanifest
      // falls through to index.html and the browser logs a manifest syntax error.
      devOptions: { enabled: true, type: 'module' },
      includeAssets: [
        'favicon.svg', 'icon-192.svg', 'icon-512.svg',
        'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
      ],
      manifest: {
        name: 'MacroFit — Nutrition, Training & Coaching',
        short_name: 'MacroFit',
        description: 'Track macros, log training, and get coaching that adapts to your real data',
        theme_color: '#0C8261',
        background_color: '#FAFAF9',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['health', 'fitness', 'lifestyle'],
        // PNG first: several launchers (and iOS) will not rasterize an SVG icon.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Full-bleed artwork, safe to crop to any mask shape.
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: 'Log food', short_name: 'Log', url: '/diary' },
          { name: 'Start workout', short_name: 'Workout', url: '/workout' },
          { name: 'Progress', short_name: 'Progress', url: '/progress' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/world\.openfoodfacts\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-food-facts',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.nal\.usda\.gov\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'usda-api',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
}))
