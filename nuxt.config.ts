// Nuxt 4.x configuration — see https://nuxt.com/docs/4.x/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@vite-pwa/nuxt'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // This is an authenticated back-office app, not a public site. Client-only
  // rendering keeps the Bearer/refresh flow entirely in the browser and lets
  // the PWA work offline from a static shell. See Nuxt 4 rendering docs.
  ssr: false,

  css: ['~/assets/css/main.css'],

  // NUXT_PUBLIC_API_BASE_URL overrides this at dev/build/runtime.
  runtimeConfig: {
    public: {
      apiBaseUrl: 'http://localhost:5000/api'
    }
  },

  app: {
    head: {
      title: 'MediMove Console',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'MediMove operations console for dispatch, providers, hospitals and administrators.' },
        { name: 'theme-color', content: '#145B63' }
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap' }
      ]
    }
  },

  // Recommended Nuxt PWA module (nuxt.com/modules/vite-pwa-nuxt).
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'MediMove Console',
      short_name: 'MediMove',
      description: 'MediMove operations console',
      lang: 'en-NG',
      display: 'standalone',
      background_color: '#F4F7F8',
      theme_color: '#145B63',
      icons: [
        {
          src: '/icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        }
      ]
    },
    // @vite-pwa/nuxt 2.x uses `generateSW` (the old `workbox` key is deprecated).
    generateSW: {
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']
    },
    devOptions: {
      enabled: false
    }
  }
})
