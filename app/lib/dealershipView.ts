/**
 * The dealership list's "view" — every filter a person can set on /crm/dealership — and how it is
 * written into the page address and read back.
 *
 * The address always shows the filters that are on (`?stage=Replied&state=CT&audit=gt10`), so a
 * filtered list can be bookmarked, reloaded or sent to a colleague. Only filters that are ON appear:
 * the plain list is just /crm/dealership. Pure functions — no Vue, no window — so the server render,
 * the browser and the tests all read an address the same way.
 */
export interface ViewCondition { field: string, op: string, value: string }

export interface DealershipView {
  /** Search text (in the address, but not remembered between visits — see useListView `transient`). */
  q: string
  /** Quick view tab: all · won · stalled · followUps · … */
  view: string
  stage: string
  source: string
  /** Owner's user id, or '__none' for unassigned. */
  owner: string
  state: string
  city: string
  territory: string
  /** Route name, or '__none' for dealerships without a route. */
  route: string
  brand: string
  /** Dealer group, or '__none' for independent dealerships. */
  group: string
  next: string
  touch: string
  audit: string
  contacts: string
  added: string
  /** Activity & history conditions ("emailed twice, no reply"). */
  conditions: ViewCondition[]
}

export const QUICK_VIEWS = ['all', 'won', 'stalled', 'followUps', 'neverContacted', 'noNextStep', 'stale', 'unassigned', 'noContacts', 'notAudited'] as const
/** Filters with a fixed list of answers: anything else in an address is ignored. */
export const VIEW_CHOICES = {
  view: QUICK_VIEWS,
  next: ['all', 'overdue', 'today', 'upcoming', 'none'],
  touch: ['all', '7', '30', 'older30', 'never'],
  audit: ['all', 'audited', 'not', 'gt10', 'gt20'],
  contacts: ['all', 'yes', 'no'],
  added: ['all', '7', '30', '90'],
} as const satisfies Partial<Record<keyof DealershipView, readonly string[]>>

/** Filters whose answers come from the data (a state, a brand, an owner…). */
const OPEN_KEYS = ['stage', 'source', 'owner', 'state', 'city', 'territory', 'route', 'brand', 'group'] as const
/** "None of them" is written as `none` in the address (`owner=none`), kept as '__none' inside the page. */
const NONE_KEYS = new Set<string>(['owner', 'route', 'group'])
const CHOICE_KEYS = Object.keys(VIEW_CHOICES) as (keyof typeof VIEW_CHOICES)[]
/** The address parameter that carries the conditions, one per condition: `if=emailsSent:gte:2`. */
const CONDITION_PARAM = 'if'
/** Every address parameter this view owns — anything else in the address (`edit=1`, `discover=1`) is left alone. */
export const VIEW_PARAMS: readonly string[] = ['q', ...CHOICE_KEYS, ...OPEN_KEYS, CONDITION_PARAM]

const MAX_TEXT = 160
const MAX_CONDITIONS = 30

export const defaultDealershipView = (): DealershipView => ({
  q: '', view: 'all', stage: 'all', source: 'all', owner: 'all', state: 'all', city: 'all', territory: 'all', route: 'all', brand: 'all', group: 'all',
  next: 'all', touch: 'all', audit: 'all', contacts: 'all', added: 'all', conditions: [],
})

const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, MAX_TEXT)
const first = (v: unknown) => Array.isArray(v) ? v[0] : v
const cleanCondition = (c: any): ViewCondition | null => {
  const field = text(c?.field), op = text(c?.op)
  return field && op && /^[\w.-]+$/.test(field) && /^[\w.-]+$/.test(op) ? { field, op, value: text(c?.value) } : null
}

/** Keeps only what a view may contain — used for anything that comes from outside (storage, the server, an address). */
export function normalizeDealershipView(raw: unknown, opts: { stages?: readonly string[] } = {}): DealershipView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = defaultDealershipView()
  out.q = text(r.q)
  for (const k of CHOICE_KEYS) { const v = text(r[k]); if ((VIEW_CHOICES[k] as readonly string[]).includes(v)) out[k] = v }
  for (const k of OPEN_KEYS) { const v = text(r[k]); if (v) out[k] = v }
  if (opts.stages && out.stage !== 'all' && !opts.stages.includes(out.stage)) out.stage = 'all'
  if (Array.isArray(r.conditions)) out.conditions = r.conditions.map(cleanCondition).filter((c): c is ViewCondition => !!c).slice(0, MAX_CONDITIONS)
  return out
}

/** The address parameters of a view: only the filters that are on, in a fixed order (so equal views give equal addresses). */
export function dealershipViewToQuery(view: DealershipView): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  if (view.q.trim()) out.q = view.q.trim()
  for (const k of CHOICE_KEYS) if (view[k] !== 'all') out[k] = view[k]
  for (const k of OPEN_KEYS) if (view[k] !== 'all') out[k] = NONE_KEYS.has(k) && view[k] === '__none' ? 'none' : view[k]
  if (view.conditions.length) out[CONDITION_PARAM] = view.conditions.map(c => `${c.field}:${c.op}:${c.value}`)
  return out
}

/** Reads a view from address parameters. `has` says whether the address names any filter at all. */
export function dealershipViewFromQuery(query: Record<string, unknown>, opts: { stages?: readonly string[] } = {}): { view: DealershipView, has: boolean } {
  const raw: Record<string, unknown> = { q: first(query.q) }
  for (const k of CHOICE_KEYS) raw[k] = first(query[k])
  for (const k of OPEN_KEYS) { const v = text(first(query[k])); raw[k] = NONE_KEYS.has(k) && v === 'none' ? '__none' : v }
  const ifs = query[CONDITION_PARAM]
  raw.conditions = (Array.isArray(ifs) ? ifs : ifs ? [ifs] : []).map((s) => {
    // field:op:value — the value may itself contain colons.
    const [field, op, ...rest] = String(s ?? '').split(':')
    return { field, op, value: rest.join(':') }
  })
  const view = normalizeDealershipView(raw, opts)
  return { view, has: Object.keys(dealershipViewToQuery(view)).length > 0 }
}

/** One line that is the same for the same filters — to compare two views, or a view with an address. */
export const dealershipViewKey = (view: DealershipView) => JSON.stringify(dealershipViewToQuery(view))
