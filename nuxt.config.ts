import tailwindcss from '@tailwindcss/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  spaLoadingTemplate: false,
  devtools: { enabled: false },

  devServer: {
    port: 1002,
    host: '0.0.0.0',
  },

  watch: ['~/app.config.ts'],

  css: ['~/assets/css/tailwind.css'],
  vite: {
    plugins: [
      tailwindcss() as any,
    ],
    optimizeDeps: {
      include: [
        'pinia',
        'reka-ui',
        'class-variance-authority',
        'vue-sonner',
        'clsx',
        'tailwind-merge',
        'three',
        'lucide-vue-next',
        '@number-flow/vue',
        '@internationalized/date',
        '@unovis/ts',
        '@unovis/vue',
        'nanoid',
        'vuedraggable',
        'embla-carousel-vue',
        '@tanstack/vue-table',
        'zod',
        'vee-validate',
        '@vee-validate/zod',
        'date-fns',
        'vaul-vue',
      ],
    },
    server: {
      watch: {
        ignored: ['**/node_modules/**', '**/.git/**'],
      },
    },
  },

  components: [
    {
      path: '~/components',
      extensions: ['.vue'],
    },
  ],

  modules: [
    'shadcn-nuxt',
    '@vueuse/nuxt',
    '@nuxt/eslint',
    '@nuxt/icon',
    '@pinia/nuxt',
    '@nuxtjs/color-mode',
    '@nuxt/fonts',
  ],

  shadcn: {
    /**
     * Prefix for all the imported component
     */
    prefix: '',
    /**
     * Directory that the component lives in.
     * @default "~/components/ui"
     */
    componentDir: '~/components/ui',
  },

  colorMode: {
    classSuffix: '',
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  fonts: {
    defaults: {
      weights: [300, 400, 500, 600, 700, 800],
    },
  },



  imports: {
    dirs: [
      './lib',
    ],
  },

  nitro: {
    // Vercel: the Inventory Scanner runs a whole scan inside one request (Pro plan maximum = 800 s,
    // needs Fluid compute). Normal requests are unaffected — they still finish in milliseconds.
    // memory 3009 MB: the headless Chromium that scans dealer sites (2–3 tabs at once in a batch)
    // dies with "Browser connection is closed" when it runs out of the default 1–2 GB.
    vercel: { functions: { maxDuration: 800, memory: 3009 } },
  },

  compatibilityDate: '2024-12-14',
})

