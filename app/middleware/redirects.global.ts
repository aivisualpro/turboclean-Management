export default defineNuxtRouteMiddleware((to) => {
  const redirects: Record<string, string> = {
    '/components': '/components/accordion',
    '/settings': '/settings/profile',
  }

  if (redirects[to.path]) {
    return navigateTo(redirects[to.path], { redirectCode: 301 })
  }
})
