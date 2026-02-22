export default defineNuxtRouteMiddleware(() => {
  const { clearHeader } = usePageHeader()
  clearHeader()
})
