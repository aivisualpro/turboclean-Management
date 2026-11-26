/**
 * A list's filters, kept in step with two places:
 *
 *  1. **The page address.** Every filter that is on shows in the address the moment it changes
 *     (`/crm/dealership?stage=Replied&state=CT`), so the filtered list can be reloaded, bookmarked or
 *     sent to a colleague. Changing a filter replaces the address (Back still leaves the page).
 *  2. **The signed-in person's account.** The filters they last had are stored for them (not for the
 *     browser, not for everyone): opening the list without filters in the address — from the menu,
 *     on another computer, tomorrow — puts them back.
 *
 * Who wins: an address that names filters always wins (a link from a report, a shared link) and then
 * becomes what is remembered. An address without filters gets the remembered ones.
 *
 * The page keeps its own refs; this only reads them (`read`), sets them (`apply`) and moves the data.
 * `await view.start()` runs during the page's setup — on the server too, so the first paint already
 * shows the right rows — and everything else starts once the page is in the browser.
 */
export interface ListViewOptions<T> {
  /** The filters as they are on screen now. */
  read: () => T
  /** Put these filters on screen. */
  apply: (view: T) => void
  /** Keeps only what a view may contain (for what comes back from the account). */
  normalize: (raw: unknown) => T
  /** The address parameters of a view — only filters that are on. The plain list gives `{}`. */
  toQuery: (view: T) => Record<string, string | string[]>
  /** Reads a view from an address; `has` = the address names at least one filter. */
  fromQuery: (query: Record<string, unknown>) => { view: T, has: boolean }
  /** The address parameters this view owns. Other parameters in the address are never touched. */
  params: readonly string[]
  /** What should not be remembered between visits (search text): returns the view without it. */
  forget?: (view: T) => T
}
interface Remembered { user: string, view: unknown, updatedAt: number }

const URL_DELAY = 250
const SAVE_DELAY = 700

export function useListView<T>(id: string, o: ListViewOptions<T>) {
  const route = useRoute()
  const router = useRouter()
  const api = useApi()
  const { user } = useAuth()
  const endpoint = `/api/crm/list-views/${encodeURIComponent(id)}`
  const homePath = route.path
  /** The remembered view as last known in this visit: coming back from another page needs no request. */
  const remembered = useState<Remembered | null>(`list-view:${id}`, () => null)
  const asked = useState<string | null>(`list-view:${id}:asked`, () => null)
  /** Where the filters on screen came from when the page opened. */
  const source = ref<'address' | 'remembered' | 'plain'>('plain')

  const userKey = () => { const u = user.value as any; return String(u?.id || u?._id || u?.email || '') }
  const keyOf = (view: T) => JSON.stringify(o.toQuery(view))
  const kept = (view: T) => o.forget ? o.forget(view) : view
  /** The view's own part of an address, in one comparable line (a single value and a one-item list read the same). */
  const shape = (query: Record<string, unknown>) => JSON.stringify(o.params
    .map(k => [k, (Array.isArray(query[k]) ? query[k] as unknown[] : query[k] == null ? [] : [query[k]]).map(String)] as const)
    .filter(([, v]) => v.length))

  /** First thing the page does. The address decides; an address without filters gets the person's last ones. */
  async function start() {
    const fromAddress = o.fromQuery(route.query)
    if (fromAddress.has) { o.apply(fromAddress.view); source.value = 'address'; return source.value }
    const me = userKey()
    // Another person signed in during this visit: what is cached is not theirs.
    if (remembered.value && remembered.value.user !== me) { remembered.value = null; asked.value = null }
    if (asked.value !== me) {
      try {
        const res = await api<{ view: { view: unknown, updatedAt: number } | null }>(endpoint, { timeout: 4000 })
        if (res?.view) remembered.value = { user: me, view: res.view.view, updatedAt: Number(res.view.updatedAt) || 0 }
      }
      catch { /* not signed in / offline: the list simply opens without filters */ }
      asked.value = me
    }
    if (remembered.value) {
      const view = o.normalize(remembered.value.view)
      if (keyOf(view) !== '{}') { o.apply(view); source.value = 'remembered' }
    }
    return source.value
  }

  // ─── In the browser: keep the address and the account in step with what is on screen ───
  let written = ''
  let urlTimer: ReturnType<typeof setTimeout> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function writeAddress() {
    const want = o.toQuery(o.read())
    written = shape(want)
    if (route.path !== homePath || shape(route.query) === written) return
    const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => !o.params.includes(k)))
    router.replace({ query: { ...rest, ...want }, hash: route.hash }).catch(() => {})
  }
  function save(keepalive = false) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const r = remembered.value
    if (!r) return
    $fetch(endpoint, { method: 'PUT', body: { view: r.view, updatedAt: r.updatedAt }, keepalive }).catch(() => { /* kept for this visit; the next change tries again */ })
  }
  function remember() {
    const view = kept(o.read())
    const key = keyOf(view)
    const before = remembered.value ? keyOf(o.normalize(remembered.value.view)) : '{}'
    if (key === before) return
    remembered.value = { user: userKey(), view, updatedAt: Date.now() }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DELAY)
  }
  function sync() { urlTimer = null; writeAddress(); remember() }
  const onPageHide = () => { if (saveTimer) save(true) }

  onMounted(() => {
    // What the page opened with (remembered filters, or a link's) shows in the address and is what is remembered.
    sync()
    watch(() => keyOf(o.read()), () => {
      if (urlTimer) clearTimeout(urlTimer)
      urlTimer = setTimeout(sync, URL_DELAY)
    })
    watch(() => route.query, (query) => {
      // (while leaving, `route` already is the next page's)
      if (route.path !== homePath || shape(query) === written) return
      const parsed = o.fromQuery(query)
      // A link with filters was followed while the list is open: it wins. The bare address (the menu
      // link) keeps the filters that are on and gets them written back.
      if (parsed.has) o.apply(parsed.view)
      else writeAddress()
    })
    window.addEventListener('pagehide', onPageHide)
  })
  onBeforeUnmount(() => {
    if (urlTimer) { clearTimeout(urlTimer); remember() }
    if (saveTimer) save()
    if (import.meta.client) window.removeEventListener('pagehide', onPageHide)
  })

  return { start, source }
}
