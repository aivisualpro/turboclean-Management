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

  compatibilityDate: '2024-12-14',
})

