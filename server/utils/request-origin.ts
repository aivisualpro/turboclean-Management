import type { H3Event } from 'h3'
/** Public origin of this request (https://zrzops.com) — used for server-to-server calls to ourselves. */
export function requestOrigin(event: H3Event) {
  try { return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin } catch { return null }
}
