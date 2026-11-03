export const LEAD_SOURCES = [
  'Manual research',
  'Cold email',
  'Cold call',
  'Walk-in',
  'Referral',
  'Existing client introduction',
  'Dealer group relationship',
  'Website/inbound',
  'Other',
] as const

export const CONTACT_ROLES = [
  'Owner',
  'Dealer Principal',
  'General Manager',
  'General Sales Manager',
  'Used Car Manager',
  'Fixed Operations Director',
  'Service Manager',
  'Internet/BDC Manager',
  'Controller/CFO',
  'Other',
] as const

/** Sales pipeline — in order. `Won` promotes the dealership to an operational Dealer. */
export const DEALERSHIP_STAGES = [
  'Research Needed',
  'Researched',
  'Ready to Contact',
  'Outreach Active',
  'Replied',
  'Conversation',
  'Meeting Scheduled',
  'Meeting Completed',
  'Opportunity',
  'Proposal Sent',
  'Negotiating',
  'Won',
  'Lost',
  'Nurture / Follow Up Later',
] as const
export type DealershipStage = typeof DEALERSHIP_STAGES[number]
export const DEFAULT_STAGE: DealershipStage = 'Research Needed'
export const WON_STAGE: DealershipStage = 'Won'
export const LOST_STAGE: DealershipStage = 'Lost'
/** Stages where the deal is no longer moving through the funnel. */
export const CLOSED_STAGES: readonly string[] = ['Won', 'Lost']
/** Open (active-funnel) stages, i.e. everything before Won. */
/** Open deals sitting in one stage longer than this are flagged as stalled. */
export const STALLED_STAGE_DAYS = 30
export const OPEN_STAGES: readonly string[] = DEALERSHIP_STAGES.slice(0, DEALERSHIP_STAGES.indexOf('Won'))

export const CONTACT_METHODS: { value: string, label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Office phone' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'text', label: 'Text / SMS' },
  { value: 'in-person', label: 'In person' },
]

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
] as const

/** Visual language per lead source — one hue family per acquisition channel. */
export const LEAD_SOURCE_STYLE: Record<string, { dot: string, badge: string }> = {
  'Manual research': { dot: 'bg-slate-500', badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20' },
  'Cold email': { dot: 'bg-sky-500', badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20' },
  'Cold call': { dot: 'bg-indigo-500', badge: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20' },
  'Walk-in': { dot: 'bg-teal-500', badge: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20' },
  'Referral': { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' },
  'Existing client introduction': { dot: 'bg-lime-500', badge: 'bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/20' },
  'Dealer group relationship': { dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20' },
  'Website/inbound': { dot: 'bg-violet-500', badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20' },
  'Other': { dot: 'bg-zinc-400', badge: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20' },
}

export const STAGE_STYLE: Record<string, { dot: string, badge: string, ring: string, bar: string }> = {
  'Research Needed': { dot: 'bg-slate-500', badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20', ring: 'ring-slate-500/30', bar: 'bg-slate-500' },
  'Researched': { dot: 'bg-stone-500', badge: 'bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/20', ring: 'ring-stone-500/30', bar: 'bg-stone-500' },
  'Ready to Contact': { dot: 'bg-sky-500', badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20', ring: 'ring-sky-500/30', bar: 'bg-sky-500' },
  'Outreach Active': { dot: 'bg-blue-500', badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20', ring: 'ring-blue-500/30', bar: 'bg-blue-500' },
  'Replied': { dot: 'bg-cyan-500', badge: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20', ring: 'ring-cyan-500/30', bar: 'bg-cyan-500' },
  'Conversation': { dot: 'bg-teal-500', badge: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20', ring: 'ring-teal-500/30', bar: 'bg-teal-500' },
  'Meeting Scheduled': { dot: 'bg-indigo-500', badge: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20', ring: 'ring-indigo-500/30', bar: 'bg-indigo-500' },
  'Meeting Completed': { dot: 'bg-violet-500', badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20', ring: 'ring-violet-500/30', bar: 'bg-violet-500' },
  'Opportunity': { dot: 'bg-purple-500', badge: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20', ring: 'ring-purple-500/30', bar: 'bg-purple-500' },
  'Proposal Sent': { dot: 'bg-fuchsia-500', badge: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20', ring: 'ring-fuchsia-500/30', bar: 'bg-fuchsia-500' },
  'Negotiating': { dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20', ring: 'ring-amber-500/30', bar: 'bg-amber-500' },
  'Won': { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20', ring: 'ring-emerald-500/30', bar: 'bg-emerald-500' },
  'Lost': { dot: 'bg-rose-500', badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20', ring: 'ring-rose-500/30', bar: 'bg-rose-500' },
  'Nurture / Follow Up Later': { dot: 'bg-zinc-500', badge: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20', ring: 'ring-zinc-500/30', bar: 'bg-zinc-500' },
}

/** Contact details older than this are flagged as "needs re-verification". */
export const VERIFICATION_STALE_DAYS = 90

/** ── Dealership research / inventory audit ── */
export const MERCHANDISING_ISSUES = [
  'No pricing shown',
  'No vehicle descriptions / comments',
  'Stock or manufacturer photos used',
  'No window sticker / build sheet',
  'No walk-around video',
  'Trim / options not listed',
  'Incentives or specials not shown',
  'Vehicle history (Carfax/AutoCheck) missing',
  'Photos out of order or duplicated',
] as const

export const WEBSITE_ISSUES = [
  'Outdated / sold inventory still listed',
  'Inventory search broken or slow',
  'Duplicate listings',
  'Dead links or 404s',
  'Poor mobile experience',
  'No chat / lead forms',
  'Third-party feed errors',
  'Slow page load',
] as const

export const AUDIT_SOURCES = ['manual', 'automated', 'imported'] as const

/** ── Relationship history: interaction types ── */
export interface InteractionTypeDef {
  key: string
  label: string
  group: 'Research' | 'Email' | 'Phone & text' | 'In person' | 'Deal' | 'Other'
  /** Lucide icon name (resolved in components) */
  icon: string
  /** Tailwind classes for the dot/icon chip */
  tone: string
  /** Pipeline stage this interaction usually moves a dealership to */
  suggestStage?: string
  /** Quick picks for the Result/outcome field */
  outcomes?: string[]
}
export const INTERACTION_TYPES: InteractionTypeDef[] = [
  { key: 'research_completed', label: 'Research completed', group: 'Research', icon: 'ClipboardCheck', tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400', suggestStage: 'Researched', outcomes: ['Good fit', 'Weak fit', 'Needs more research', 'Decision maker identified'] },
  { key: 'email_sent', label: 'Email sent', group: 'Email', icon: 'Send', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', suggestStage: 'Outreach Active', outcomes: ['Delivered', 'Bounced', 'Opened'] },
  { key: 'email_reply', label: 'Email reply', group: 'Email', icon: 'Reply', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', suggestStage: 'Replied', outcomes: ['Asked for info', 'Wants a call', 'Forwarded to someone else', 'Out of office'] },
  { key: 'positive_reply', label: 'Positive reply', group: 'Email', icon: 'ThumbsUp', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', suggestStage: 'Replied', outcomes: ['Interested', 'Wants a meeting', 'Wants pricing'] },
  { key: 'negative_reply', label: 'Negative reply', group: 'Email', icon: 'ThumbsDown', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', outcomes: ['Not interested', 'Has a vendor', 'Bad timing', 'Unsubscribe'] },
  { key: 'phone_call', label: 'Phone call', group: 'Phone & text', icon: 'Phone', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', suggestStage: 'Outreach Active', outcomes: ['No answer', 'Gatekeeper', 'Call back later', 'Wrong number'] },
  { key: 'connected_call', label: 'Connected phone call', group: 'Phone & text', icon: 'PhoneCall', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', suggestStage: 'Conversation', outcomes: ['Interested', 'Send info', 'Meeting booked', 'Not interested'] },
  { key: 'voicemail', label: 'Voicemail', group: 'Phone & text', icon: 'Voicemail', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', suggestStage: 'Outreach Active', outcomes: ['Left voicemail', 'Mailbox full'] },
  { key: 'text_message', label: 'Text message', group: 'Phone & text', icon: 'MessageSquareText', tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', suggestStage: 'Outreach Active', outcomes: ['Sent', 'Replied', 'No reply'] },
  { key: 'walk_in', label: 'Walk-in visit', group: 'In person', icon: 'Footprints', tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400', suggestStage: 'Conversation', outcomes: ['Met decision maker', 'Left materials', 'Manager unavailable'] },
  { key: 'conversation', label: 'Conversation', group: 'In person', icon: 'MessagesSquare', tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400', suggestStage: 'Conversation', outcomes: ['Interested', 'Needs approval', 'Not now'] },
  { key: 'meeting_scheduled', label: 'Meeting scheduled', group: 'Deal', icon: 'CalendarPlus', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', suggestStage: 'Meeting Scheduled', outcomes: ['In person', 'Video call', 'Phone'] },
  { key: 'meeting_completed', label: 'Meeting completed', group: 'Deal', icon: 'CalendarCheck', tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400', suggestStage: 'Meeting Completed', outcomes: ['Wants a proposal', 'Needs follow-up', 'Not a fit'] },
  { key: 'proposal_sent', label: 'Proposal sent', group: 'Deal', icon: 'FileText', tone: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400', suggestStage: 'Proposal Sent', outcomes: ['Sent by email', 'Presented in person'] },
  { key: 'follow_up', label: 'Follow-up', group: 'Other', icon: 'RefreshCw', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', outcomes: ['No response', 'Still interested', 'Asked to wait'] },
  { key: 'referral', label: 'Referral/introduction', group: 'Other', icon: 'Handshake', tone: 'bg-lime-500/10 text-lime-700 dark:text-lime-400', outcomes: ['Intro made', 'Referral received'] },
  { key: 'contract_won', label: 'Contract won', group: 'Deal', icon: 'Trophy', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', suggestStage: 'Won', outcomes: ['Signed'] },
  { key: 'contract_lost', label: 'Contract lost', group: 'Deal', icon: 'XCircle', tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', suggestStage: 'Lost', outcomes: ['Price', 'Competitor', 'Happy with current vendor', 'Doing it in-house', 'Bad timing', 'No response'] },
  { key: 'note', label: 'Note', group: 'Other', icon: 'StickyNote', tone: 'bg-muted text-foreground', outcomes: [] },
]
export const INTERACTION_TYPE_MAP: Record<string, InteractionTypeDef> = Object.fromEntries(INTERACTION_TYPES.map(t => [t.key, t]))
export const INTERACTION_GROUPS = ['Research', 'Email', 'Phone & text', 'In person', 'Deal', 'Other'] as const

/** ── Lost deals ── */
export const LOST_REASONS = [
  'Happy with current vendor', 'Doing it in-house', 'Price', 'No current need', 'Bad timing', 'Corporate/group decision',
  'Existing vendor relationship', 'Competitor', 'No response', 'Service-area issue', 'Quality concern', 'Other',
] as const

/** ── Follow-up system ── */
export const NURTURE_STAGE = 'Nurture / Follow Up Later'
/** Stages that are a queue rather than a conversation (listed as "to research" / "to contact"). */
export const QUEUE_STAGES: readonly string[] = ['Research Needed', 'Researched', 'Ready to Contact']
export const NEXT_ACTION_TYPES: { key: string, label: string, icon: string }[] = [
  { key: 'follow_up', label: 'Follow up', icon: 'RefreshCw' },
  { key: 'call', label: 'Call', icon: 'Phone' },
  { key: 'email', label: 'Email', icon: 'Send' },
  { key: 'meeting', label: 'Meeting', icon: 'CalendarCheck' },
  { key: 'visit', label: 'Visit', icon: 'Footprints' },
  { key: 'proposal', label: 'Proposal', icon: 'FileText' },
  { key: 'research', label: 'Research', icon: 'ClipboardCheck' },
  { key: 'other', label: 'Other', icon: 'StickyNote' },
]
export const NEXT_ACTION_TYPE_MAP: Record<string, { key: string, label: string, icon: string }> = Object.fromEntries(NEXT_ACTION_TYPES.map(t => [t.key, t]))

/** ── Email tracking ── */
export const EMAIL_MERGE_FIELDS: { key: string, label: string }[] = [
  { key: 'firstName', label: 'First name' }, { key: 'lastName', label: 'Last name' }, { key: 'fullName', label: 'Full name' },
  { key: 'contactTitle', label: 'Title' }, { key: 'dealership', label: 'Dealership' }, { key: 'dealerGroup', label: 'Dealer group' },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'website', label: 'Website' },
  { key: 'senderName', label: 'Your name' }, { key: 'senderFirstName', label: 'Your first name' },
  { key: 'senderTitle', label: 'Your title' }, { key: 'senderCompany', label: 'Your company' }, { key: 'senderPhone', label: 'Your phone' }, { key: 'senderEmail', label: 'Your email' },
  { key: 'auditDate', label: 'Audit date' }, { key: 'usedTotal', label: 'Used vehicles' }, { key: 'usedMissingPhotos', label: 'Used missing photos' }, { key: 'usedMissingPhotoPct', label: 'Used missing %' },
  { key: 'totalVehicles', label: 'All vehicles' }, { key: 'totalMissingPhotos', label: 'All missing photos' }, { key: 'missingPhotoPct', label: 'All missing %' },
]
/** Extra fields only meaningful in HTML templates. */
export const EMAIL_HTML_ONLY_FIELDS: { key: string, label: string }[] = [
  { key: 'auditDateUpper', label: 'Audit date (CAPS)' }, { key: 'auditScreenshot', label: 'Audit screenshot (image)' }, { key: 'replyMailto', label: 'Reply link (mailto:)' },
  { key: 'senderTagline', label: 'Your tagline' }, { key: 'senderRegion', label: 'Your region' }, { key: 'inventoryUrl', label: 'Inventory URL' },
]
export const EMAIL_TEMPLATE_CATEGORIES = ['First touch', 'Follow-up', 'Meeting', 'Proposal', 'Re-engage', 'Other'] as const
/** The success funnel, in order. Opens/clicks are deliberately not part of it. */
export const EMAIL_FUNNEL: { key: string, label: string }[] = [
  { key: 'replied', label: 'Replies' }, { key: 'conversation', label: 'Conversations' }, { key: 'meeting', label: 'Meetings' },
  { key: 'proposal', label: 'Proposals' }, { key: 'won', label: 'Won accounts' },
]
export const EMAIL_OUTCOMES: { key: 'conversation' | 'meeting' | 'opportunity' | 'proposal' | 'won', label: string }[] = [
  { key: 'conversation', label: 'Conversation' }, { key: 'meeting', label: 'Meeting' }, { key: 'opportunity', label: 'Opportunity' },
  { key: 'proposal', label: 'Proposal' }, { key: 'won', label: 'Won' },
]
export const EMAIL_STATUS_STYLE: Record<string, { label: string, cls: string }> = {
  queued: { label: 'Queued', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/20' },
  sent: { label: 'Sent', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' },
  bounced: { label: 'Bounced', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
  complained: { label: 'Spam report', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
  failed: { label: 'Failed', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
}
export const SENTIMENT_STYLE: Record<string, { label: string, cls: string }> = {
  positive: { label: 'Positive', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' },
  neutral: { label: 'Neutral', cls: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/25' },
  negative: { label: 'Negative', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
}
/** Client-side preview of the server's {{field}} / {{field|fallback}} merge. */
export function renderMergePreview(text: string, vars: Record<string, string>) {
  const missing = new Set<string>()
  const out = String(text || '').replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    const v = vars[key]
    if (v) return v
    if (fallback !== undefined) return fallback.trim()
    missing.add(key)
    return ''
  })
  return { text: out, missing: [...missing] }
}

// ─── Won deals ───
export const CONTRACT_STRUCTURES = ['Per vehicle', 'Per vehicle + monthly minimum', 'Monthly flat fee', 'Retainer + per vehicle', 'Trial / pilot', 'Other'] as const
export const CONTRACT_TERMS = ['Month-to-month', '3 months', '6 months', '12 months', '24 months', 'Other'] as const

// ─── Time / effort tracking ───
export const TIME_CATEGORIES = [
  { key: 'research', label: 'Dealer research', short: 'Research', icon: 'Search', color: '#2563eb' },
  { key: 'audit', label: 'Website/inventory audits', short: 'Audits', icon: 'ClipboardCheck', color: '#0891b2' },
  { key: 'email', label: 'Email prospecting', short: 'Email', icon: 'Mail', color: '#7c3aed' },
  { key: 'phone', label: 'Phone prospecting', short: 'Phone', icon: 'Phone', color: '#db2777' },
  { key: 'field', label: 'Field/walk-in prospecting', short: 'Field', icon: 'Footprints', color: '#ea580c' },
  { key: 'driving', label: 'Driving', short: 'Driving', icon: 'Car', color: '#78716c' },
  { key: 'meeting', label: 'Meetings', short: 'Meetings', icon: 'CalendarCheck', color: '#16a34a' },
  { key: 'follow_up', label: 'Follow-ups', short: 'Follow-ups', icon: 'RefreshCw', color: '#ca8a04' },
  { key: 'admin', label: 'Proposals/admin', short: 'Admin', icon: 'FileText', color: '#475569' },
] as const
export type TimeCategoryKey = typeof TIME_CATEGORIES[number]['key']
export const TIME_CATEGORY_MAP: Record<string, typeof TIME_CATEGORIES[number]> = Object.fromEntries(TIME_CATEGORIES.map(c => [c.key, c]))
/** Activity type → default time category (same map as the server). */
export const INTERACTION_TIME_CATEGORY: Record<string, string> = {
  research_completed: 'research',
  email_sent: 'email', email_reply: 'email', positive_reply: 'email', negative_reply: 'email',
  phone_call: 'phone', connected_call: 'phone', voicemail: 'phone', text_message: 'phone',
  walk_in: 'field', conversation: 'field', referral: 'field',
  meeting_scheduled: 'meeting', meeting_completed: 'meeting',
  proposal_sent: 'admin', contract_won: 'admin', contract_lost: 'admin', note: 'admin',
  follow_up: 'follow_up',
}
export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60)
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`
}
