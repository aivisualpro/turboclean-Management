import type { NavGroup, NavLink, NavMenu, NavMenuItems } from '~/types/nav'
import { navMenu, navMenuBottom } from '~/constants/menus'

/**
 * The bottom navbar on phones and tablets: up to five pages each person picks for themselves.
 * Everything that is not in the bar stays in the menu behind the burger button.
 *
 * Kept in two places so the bar is right on the first paint and the same on every device:
 *  1. this browser (localStorage) — instant, also works offline;
 *  2. the signed-in person's account (the per-person list-view store, id "mobile-nav") — the
 *     newest copy wins, so a bar changed on the phone shows up on the tablet.
 *
 * `links === null` means "never customised": the bar then shows the default pages the person is
 * allowed to see.
 */
export const NAV_FAVORITES_MAX = 5

const VIEW_ID = 'mobile-nav'
const ENDPOINT = `/api/crm/list-views/${VIEW_ID}`
const SAVE_DELAY = 500
const DEFAULT_LINKS = ['/', '/crm/today', '/crm/dealership', '/dealers', '/sales/work-orders']

interface Stored { user: string, links: string[] | null, updatedAt: number }
export interface NavFavoriteGroup { heading: string, items: NavLink[] }

const isLink = (item: NavMenuItems[number]): item is NavLink => 'link' in item
const isGroup = (item: NavMenuItems[number]): item is NavGroup => 'children' in item

/** Every page of the menu as a flat list per heading (sub-menus are opened up). */
function flatten(items: NavMenuItems): NavLink[] {
  const out: NavLink[] = []
  for (const item of items) {
    if (isLink(item)) out.push(item)
    else if (isGroup(item)) out.push(...item.children.map(c => ({ ...c, icon: c.icon || item.icon })))
  }
  return out
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function useNavFavorites() {
  const route = useRoute()
  const api = useApi()
  const { user } = useAuth()
  const { isMenuVisible } = usePermissions()

  const state = useState<Stored>('nav-favorites', () => ({ user: '', links: null, updatedAt: 0 }))
  const asked = useState<string>('nav-favorites:asked', () => '')
  /** The "Customize navbar" sheet (opened from the menu). */
  const customizeOpen = useState<boolean>('nav-favorites:customize', () => false)

  const userKey = () => { const u = user.value as any; return String(u?.id || u?._id || u?.email || '') }
  const storageKey = () => `zrz:nav-favorites:${userKey()}`

  // ─── The menu this person may see ───
  const groups = computed<NavFavoriteGroup[]>(() => [
    ...navMenu.map((g: NavMenu) => ({ heading: g.heading, items: flatten(g.items).filter(i => isMenuVisible(i.title)) })),
    { heading: 'Settings', items: flatten(navMenuBottom).filter(i => isMenuVisible(i.title)) },
  ].filter(g => g.items.length))
  const all = computed<NavLink[]>(() => groups.value.flatMap(g => g.items))
  const byLink = computed(() => new Map(all.value.map(i => [i.link, i])))

  const isCustom = computed(() => state.value.links !== null)
  const favorites = computed<NavLink[]>(() => {
    const map = byLink.value
    if (state.value.links) return state.value.links.map(l => map.get(l)).filter((i): i is NavLink => !!i).slice(0, NAV_FAVORITES_MAX)
    // Never customised: the default pages this person may open, topped up from the menu.
    const picked = DEFAULT_LINKS.map(l => map.get(l)).filter((i): i is NavLink => !!i)
    for (const item of all.value) {
      if (picked.length >= NAV_FAVORITES_MAX) break
      if (!picked.includes(item)) picked.push(item)
    }
    return picked.slice(0, NAV_FAVORITES_MAX)
  })
  const favoriteLinks = computed(() => new Set(favorites.value.map(f => f.link)))
  const isFavorite = (link: string) => favoriteLinks.value.has(link)
  const isFull = computed(() => favorites.value.length >= NAV_FAVORITES_MAX)
  /** The menu without the pages that are already in the bar. */
  const restGroups = computed<NavFavoriteGroup[]>(() => groups.value
    .map(g => ({ heading: g.heading, items: g.items.filter(i => !favoriteLinks.value.has(i.link)) }))
    .filter(g => g.items.length))

  /** The menu page the current address belongs to (/crm/dealership/123 → Dealership). */
  const activeLink = computed(() => {
    const path = route.path.replace(/\/+$/, '') || '/'
    let best = ''
    for (const { link } of all.value) {
      const hit = link === '/' ? path === '/' : path === link || path.startsWith(`${link}/`)
      if (hit && link.length > best.length) best = link
    }
    return best
  })

  // ─── Keeping it ───
  function adopt(links: unknown, updatedAt: number) {
    const clean = Array.isArray(links) ? [...new Set(links.filter((l): l is string => typeof l === 'string' && l.startsWith('/')))].slice(0, NAV_FAVORITES_MAX) : null
    state.value = { user: userKey(), links: clean, updatedAt }
  }
  function readLocal(): { links: string[] | null, updatedAt: number } | null {
    if (!import.meta.client) return null
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey()) || 'null')
      if (raw && typeof raw === 'object' && Number.isFinite(raw.updatedAt)) return { links: Array.isArray(raw.links) ? raw.links : null, updatedAt: raw.updatedAt }
    }
    catch { /* private mode / damaged entry: the account copy or the defaults are used */ }
    return null
  }
  function writeLocal() {
    if (!import.meta.client) return
    try { localStorage.setItem(storageKey(), JSON.stringify({ links: state.value.links, updatedAt: state.value.updatedAt })) }
    catch { /* storage full / private mode — the bar still works for this visit */ }
  }
  function push() {
    saveTimer = null
    const { links, updatedAt } = state.value
    const view = { custom: links ? '1' : '', items: (links || []).map(link => ({ link })) }
    $fetch(ENDPOINT, { method: 'PUT', body: { view, updatedAt } }).catch(() => { /* kept in this browser; the next change tries again */ })
  }
  function commit(links: string[] | null) {
    state.value = { user: userKey(), links, updatedAt: Date.now() }
    writeLocal()
    if (!import.meta.client) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(push, SAVE_DELAY)
  }

  /** Reads the person's bar: this browser first (instant), then their account (newest wins). */
  async function load() {
    const me = userKey()
    if (!me) return
    if (state.value.user !== me) state.value = { user: me, links: null, updatedAt: 0 }
    const local = readLocal()
    if (local && local.updatedAt > state.value.updatedAt) adopt(local.links, local.updatedAt)
    if (asked.value === me) return
    asked.value = me
    try {
      const res = await api<{ view: { view: { custom?: string, items?: { link?: string }[] }, updatedAt: number } | null }>(ENDPOINT, { timeout: 4000 })
      const remote = res?.view
      const remoteAt = Number(remote?.updatedAt) || 0
      if (remote && remoteAt > state.value.updatedAt) {
        adopt(remote.view?.custom ? (remote.view.items || []).map(i => i?.link) : null, remoteAt)
        writeLocal()
      }
      else if (import.meta.client && state.value.updatedAt > remoteAt) {
        push() // this browser has a newer bar than the account (an earlier save did not get through)
      }
    }
    catch { /* offline / not signed in: this browser's copy or the defaults are shown */ }
  }

  // ─── Changing it ───
  /** Adds a page to the bar. Returns false when the bar already has five. */
  function add(link: string): boolean {
    if (!byLink.value.has(link) || isFavorite(link)) return true
    if (isFull.value) return false
    commit([...favorites.value.map(f => f.link), link])
    return true
  }
  function remove(link: string) {
    if (!isFavorite(link)) return
    commit(favorites.value.map(f => f.link).filter(l => l !== link))
  }
  function toggle(link: string): boolean { if (isFavorite(link)) { remove(link); return true } return add(link) }
  /** Moves a page one place left (-1) or right (+1) in the bar. */
  function move(link: string, delta: -1 | 1) {
    const links = favorites.value.map(f => f.link)
    const from = links.indexOf(link)
    const to = from + delta
    if (from < 0 || to < 0 || to >= links.length) return
    links.splice(to, 0, links.splice(from, 1)[0]!)
    commit(links)
  }
  /** Back to the default bar. */
  function reset() { commit(null) }

  return { favorites, restGroups, groups, activeLink, isFavorite, isFull, isCustom, customizeOpen, load, add, remove, toggle, move, reset }
}
