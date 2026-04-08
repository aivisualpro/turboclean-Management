export default defineNuxtPlugin({
  name: 'payload-fix-client',
  enforce: 'pre',
  setup(nuxtApp) {
    if (import.meta.client) {
      if (!nuxtApp._payloadRevivers) {
        nuxtApp._payloadRevivers = {}
      }
    }
  }
})
