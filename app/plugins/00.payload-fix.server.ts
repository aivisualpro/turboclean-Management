export default defineNuxtPlugin({
  name: 'payload-fix',
  enforce: 'pre',
  setup(nuxtApp) {
    if (import.meta.server) {
      if (nuxtApp.ssrContext && !nuxtApp.ssrContext._payloadReducers) {
        nuxtApp.ssrContext._payloadReducers = {}
      }
    }
  }
})
