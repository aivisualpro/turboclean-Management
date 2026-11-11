/**
 * `$fetch` for our own /api routes that also works while a page is being built on the server.
 *
 * In the browser this is plain `$fetch` (the sign-in cookie travels with every request by itself).
 * On the server — the first paint after a reload or when a link is opened directly — a plain
 * `$fetch('/api/…')` is a new, anonymous request: it does NOT carry the visitor's cookie, so every
 * signed-in-only API answers 401 and the page renders as if there were no data. `useRequestFetch()`
 * passes the visitor's cookie along.
 *
 * Call it at the top of a composable or page setup (not inside a later callback) and use the
 * returned function for anything that may run during the first render (useAsyncData, top-level await).
 */
export function useApi(): typeof $fetch {
  if (import.meta.client) return $fetch
  try { return useRequestFetch() as typeof $fetch }
  catch { return $fetch }
}
