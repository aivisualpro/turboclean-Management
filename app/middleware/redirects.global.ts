export default defineNuxtRouteMiddleware((to) => {
  const redirects: Record<string, string> = {
    '/components': '/components/accordion',
    '/settings': '/settings/profile',
    // Tasks module was removed — send old bookmarks/open tabs home
    '/tasks': '/',
  }

  if (redirects[to.path]) {
    return navigateTo(redirects[to.path], { redirectCode: 301 })
  }
})
