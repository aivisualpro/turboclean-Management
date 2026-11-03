/**
 * Performance analytics — "what actually works", compared by any dimension.
 *  dealership-level: dealerships first contacted in the period, and how far each one got (ever)
 *  email-level:      emails sent in the period and what each produced (reply / meeting / won)
 *  channels:         email vs call vs walk-in — touches, hours, meetings and revenue they produced
 */
import type { Db } from 'mongodb'
import { buildFacts, missingPhotoBand, MISSING_BANDS, sizeBand, SIZE_BANDS, touchesBand, TOUCH_BANDS, zoned, CHANNEL_LABEL } from './crm-facts'
import type { DealershipFacts } from './crm-facts'

export const MIN_GROUP = 10
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (a: number, b: number) => b ? r1((a / b) * 100) : null
const avg = (xs: number[]) => xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : r1((s[m - 1]! + s[m]!) / 2) }

export const DEALERSHIP_DIMENSIONS = {
  leadSource: { label: 'Lead source', of: (f: DealershipFacts) => [f.leadSource || '—'] },
  missingPhotos: { label: 'Missing-photo %', of: (f: DealershipFacts) => [missingPhotoBand(f.missingPhotoPct)], order: MISSING_BANDS },
  brand: { label: 'Brand', of: (f: DealershipFacts) => f.brands.length ? f.brands : ['No brand'] },
  dealerGroup: { label: 'Dealer group', of: (f: DealershipFacts) => [f.dealerGroup || 'Independent'] },
  state: { label: 'State', of: (f: DealershipFacts) => [f.state || '—'] },
  market: { label: 'City / market', of: (f: DealershipFacts) => [f.city ? `${f.city}${f.state ? `, ${f.state}` : ''}` : '—'] },
  size: { label: 'Dealership size', of: (f: DealershipFacts) => [sizeBand(f.totalVehicles)], order: SIZE_BANDS },
  contactRole: { label: 'Primary contact', of: (f: DealershipFacts) => [f.primaryRole] },
  channelMix: { label: 'Email / call / walk-in mix', of: (f: DealershipFacts) => [f.channelMix] },
  firstTouch: { label: 'First touch', of: (f: DealershipFacts) => [f.firstTouchChannel ? CHANNEL_LABEL[f.firstTouchChannel as keyof typeof CHANNEL_LABEL] : 'Other'] },
  touches: { label: 'Number of touches', of: (f: DealershipFacts) => [touchesBand(f.counts.touches)], order: TOUCH_BANDS },
  outreachMode: { label: 'Personalized vs template', of: (f: DealershipFacts) => [f.outreachMode] },
} as const
export type DealershipDimension = keyof typeof DEALERSHIP_DIMENSIONS

export const EMAIL_DIMENSIONS = {
  template: 'Email template', version: 'Template version', subject: 'Subject line', campaign: 'Campaign', dayOfWeek: 'Day of week',
  sendHour: 'Send time', followUp: 'Follow-up number', recipientRole: 'Recipient job title', mode: 'Personalized vs template', missingPhotos: 'Missing-photo %',
} as const
export type EmailDimension = keyof typeof EMAIL_DIMENSIONS
const DOW_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const hourLabel = (h: number) => { const f = (x: number) => `${((x + 11) % 12) + 1}${x < 12 ? 'am' : 'pm'}`; return `${f(h)}–${f((h + 1) % 24)}` }

function dealershipGroups(facts: DealershipFacts[], dim: DealershipDimension) {
  const def = DEALERSHIP_DIMENSIONS[dim]
  const m = new Map<string, DealershipFacts[]>()
  for (const f of facts) for (const k of def.of(f)) m.set(k, [...(m.get(k) || []), f])
  const rows = [...m.entries()].map(([key, list]) => {
    const n = list.length
    const has = (s: keyof DealershipFacts['steps']) => list.filter(f => !!f.steps[s]).length
    const won = list.filter(f => f.won)
    const minutes = list.reduce((a, f) => a + f.minutes, 0)
    const revenue = r2(won.reduce((a, f) => a + f.annualRevenue, 0))
    return {
      key, n, enough: n >= MIN_GROUP,
      replied: has('replied'), conversation: has('conversation'), meeting: has('meeting'), proposal: has('proposal'), won: won.length,
      replyRate: pct(has('replied'), n), conversationRate: pct(has('conversation'), n), meetingRate: pct(has('meeting'), n), proposalRate: pct(has('proposal'), n), winRate: pct(won.length, n),
      annualRevenue: revenue, revenuePerDealership: n ? r2(revenue / n) : 0,
      avgTouchesToMeeting: avg(list.map(f => f.touchesBeforeMeeting).filter((x): x is number => x != null)),
      hours: r1(minutes / 60), revenuePerHour: minutes ? r2(revenue / (minutes / 60)) : null,
    }
  })
  const order = (def as any).order as string[] | undefined
  return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.n - a.n)
}

export async function performance(db: Db, q: { from?: string, to?: string, userId?: string, dimension?: string, emailDimension?: string }) {
  const inRange = (v?: string | null) => !!v && (!q.from || v.slice(0, 10) >= q.from) && (!q.to || v.slice(0, 10) <= q.to)
  const all = await buildFacts(db, { includeArchived: true })
  const scoped = q.userId ? all.filter(f => f.ownerId === q.userId) : all
  const contacted = scoped.filter(f => f.steps.contacted && inRange(f.steps.contacted))
  const factsById = new Map(all.map(f => [f.id, f]))

  // ── Dealership dimensions ──
  const dim = (q.dimension && q.dimension in DEALERSHIP_DIMENSIONS ? q.dimension : 'leadSource') as DealershipDimension
  const byDealership = dealershipGroups(contacted, dim)

  // ── Email dimensions ──
  const emailMatch: any = { direction: 'outbound', status: { $ne: 'failed' } }
  if (q.from || q.to) emailMatch.sentAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: `${q.to}T23:59:59.999Z` } : {}) }
  if (q.userId) emailMatch['sentBy.id'] = q.userId
  const [emails, contacts, templates] = await Promise.all([
    db.collection('turboCleanCrmEmails').find(emailMatch, { projection: { dealershipId: 1, sentAt: 1, repliedAt: 1, replySentiment: 1, templateId: 1, templateName: 1, templateVersionLabel: 1, templateEdited: 1, subjectVariant: 1, subjectTemplate: 1, campaignName: 1, followUpNumber: 1, contactId: 1, outcomes: 1 } }).toArray(),
    db.collection('turboCleanCrmContacts').find({}, { projection: { role: 1 } }).toArray(),
    db.collection('turboCleanCrmEmailTemplates').find({}, { projection: { subjects: 1 } }).toArray(),
  ])
  const roleOf = new Map(contacts.map(c => [c._id.toString(), c.role || 'Other']))
  const subjectText = new Map<string, string>()
  for (const t of templates) for (const s of t.subjects || []) subjectText.set(`${t._id.toString()}:${s.key}`, s.text)
  const edim = (q.emailDimension && q.emailDimension in EMAIL_DIMENSIONS ? q.emailDimension : 'template') as EmailDimension
  const keyOf = (e: any): string => {
    switch (edim) {
      case 'template': return e.templateName || 'No template'
      case 'version': return e.templateName ? `${e.templateName} · ${e.templateVersionLabel || '—'}` : 'No template'
      case 'subject': return (e.templateId && e.subjectVariant && subjectText.get(`${e.templateId}:${e.subjectVariant}`)) || e.subjectTemplate || '—'
      case 'campaign': return e.campaignName || 'No campaign'
      case 'dayOfWeek': return zoned(e.sentAt).dow
      case 'sendHour': return hourLabel(zoned(e.sentAt).hour)
      case 'followUp': return !e.followUpNumber ? 'First email' : e.followUpNumber >= 3 ? 'Follow-up 3+' : `Follow-up ${e.followUpNumber}`
      case 'recipientRole': return (e.contactId && roleOf.get(e.contactId)) || 'Unknown'
      case 'mode': return !e.templateId ? 'Written from scratch' : e.templateEdited ? 'Template, personalized' : 'Template, unedited'
      case 'missingPhotos': return missingPhotoBand(factsById.get(e.dealershipId)?.missingPhotoPct)
    }
  }
  const eg = new Map<string, any[]>()
  for (const e of emails) { const k = keyOf(e); eg.set(k, [...(eg.get(k) || []), e]) }
  const hourIdx = (k: string) => { for (let h = 0; h < 24; h++) if (hourLabel(h) === k) return h; return 99 }
  const byEmail = [...eg.entries()].map(([key, list]) => {
    const n = list.length
    const replied = list.filter(e => e.repliedAt).length
    const positive = list.filter(e => e.replySentiment === 'positive').length
    const meeting = list.filter(e => e.outcomes?.meeting).length
    const wonDealerships = [...new Set(list.filter(e => e.outcomes?.won).map(e => e.dealershipId))]
    const revenue = r2(wonDealerships.reduce((a, id) => a + (factsById.get(id)?.annualRevenue || 0), 0))
    return { key, n, enough: n >= 20, replied, positive, meeting, won: wonDealerships.length, replyRate: pct(replied, n), positiveRate: pct(positive, n), meetingRate: pct(meeting, n), winRate: pct(wonDealerships.length, n), annualRevenue: revenue }
  }).sort((a, b) => edim === 'dayOfWeek' ? DOW_ORDER.indexOf(a.key) - DOW_ORDER.indexOf(b.key)
    : edim === 'sendHour' ? hourIdx(a.key) - hourIdx(b.key)
    : edim === 'followUp' ? a.key.localeCompare(b.key)
    : edim === 'missingPhotos' ? MISSING_BANDS.indexOf(a.key) - MISSING_BANDS.indexOf(b.key)
    : b.n - a.n)

  // ── Channels: email vs call vs walk-in ──
  const ixMatch: any = { voidedAt: null, type: { $in: ['email_sent', 'phone_call', 'connected_call', 'voicemail', 'text_message', 'walk_in', 'conversation'] } }
  if (q.from || q.to) ixMatch.occurredAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: `${q.to}T23:59:59.999Z` } : {}) }
  if (q.userId) ixMatch['user.id'] = q.userId
  const tMatch: any = { endedAt: { $ne: null }, voidedAt: null }
  if (q.from || q.to) tMatch.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
  if (q.userId) tMatch.userId = q.userId
  const [ix, time] = await Promise.all([
    db.collection('turboCleanCrmInteractions').find(ixMatch, { projection: { type: 1, dealershipId: 1 } }).toArray(),
    db.collection('turboCleanCrmTimeEntries').aggregate([{ $match: tMatch }, { $group: { _id: '$category', minutes: { $sum: '$minutes' } } }]).toArray(),
  ])
  const minutesBy = new Map(time.map(t => [String(t._id), Number(t.minutes) || 0]))
  const CH = {
    email: { types: ['email_sent'], cats: ['email'] },
    call: { types: ['phone_call', 'connected_call', 'voicemail', 'text_message'], cats: ['phone'] },
    visit: { types: ['walk_in', 'conversation'], cats: ['field', 'driving'] },
  } as const
  const meetingsIn = scoped.filter(f => f.firstMeetingAt && inRange(f.firstMeetingAt))
  const winsIn = scoped.filter(f => f.won && inRange(f.wonAt))
  const channels = (Object.keys(CH) as (keyof typeof CH)[]).map((ch) => {
    const touches = ix.filter(i => (CH[ch].types as readonly string[]).includes(i.type))
    const minutes = CH[ch].cats.reduce((a, c) => a + (minutesBy.get(c) || 0), 0)
    const hours = r1(minutes / 60)
    const meetings = meetingsIn.filter(f => f.meetingChannel === ch).length
    const wins = winsIn.filter(f => (f.meetingChannel || f.firstTouchChannel) === ch)
    const revenue = r2(wins.reduce((a, f) => a + f.annualRevenue, 0))
    return {
      key: ch, label: CHANNEL_LABEL[ch], touches: touches.length, dealerships: new Set(touches.map(t => t.dealershipId)).size, hours,
      meetings, wins: wins.length, annualRevenue: revenue,
      meetingsPer10Hours: hours ? r1((meetings / hours) * 10) : null, revenuePerHour: hours ? r2(revenue / hours) : null,
      touchesPerMeeting: meetings ? r1(touches.length / meetings) : null,
    }
  })

  // ── Touches before a meeting ──
  const tbm = meetingsIn.map(f => f.touchesBeforeMeeting).filter((x): x is number => x != null)
  const touchDist = TOUCH_BANDS.map(b => ({ key: b, n: tbm.filter(t => touchesBand(Math.max(1, t)) === b).length }))

  // ── Answers to the standing questions ──
  const insights: { question: string, answer: string, enough: boolean }[] = []
  const tplRows = (() => {
    const m = new Map<string, any[]>()
    for (const e of emails) { if (!e.templateName) continue; m.set(e.templateName, [...(m.get(e.templateName) || []), e]) }
    return [...m.entries()].map(([k, l]) => ({ key: k, n: l.length, meetings: l.filter(e => e.outcomes?.meeting).length })).map(r => ({ ...r, rate: pct(r.meetings, r.n) }))
  })()
  const bestTpl = [...tplRows].filter(r => r.n >= 20).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0]
  const mostTpl = [...tplRows].sort((a, b) => b.meetings - a.meetings)[0]
  insights.push({ question: 'Which email produces the most meetings?', enough: !!bestTpl,
    answer: bestTpl ? `“${bestTpl.key}” — ${bestTpl.rate}% of its ${bestTpl.n} emails led to a meeting${mostTpl && mostTpl.key !== bestTpl.key ? ` (most meetings in total: “${mostTpl.key}”, ${mostTpl.meetings})` : ''}.`
      : mostTpl?.meetings ? `So far “${mostTpl.key}” has the most meetings (${mostTpl.meetings}), but no template has 20+ sends yet.` : 'Not enough emails with meetings yet.' })
  const hi = contacted.filter(f => f.missingPhotoPct != null && f.missingPhotoPct > 15), lo = contacted.filter(f => f.missingPhotoPct != null && f.missingPhotoPct <= 15)
  const rr = (l: DealershipFacts[]) => pct(l.filter(f => f.steps.replied).length, l.length)
  insights.push({ question: 'Do dealerships with more than 15% missing photos respond more often?', enough: hi.length >= MIN_GROUP && lo.length >= MIN_GROUP,
    answer: hi.length && lo.length ? `Over 15% missing: ${rr(hi)}% replied (${hi.length} dealerships) vs ${rr(lo)}% at 15% or less (${lo.length}).` : 'Needs audited dealerships on both sides of 15%.' })
  const roleRate = (role: string) => { const l = emails.filter(e => e.contactId && roleOf.get(e.contactId) === role); return { n: l.length, rate: pct(l.filter(e => e.repliedAt).length, l.length) } }
  const gm = roleRate('General Manager'), ucm = roleRate('Used Car Manager')
  insights.push({ question: 'Do GMs or used-car managers respond more often?', enough: gm.n >= 20 && ucm.n >= 20,
    answer: gm.n || ucm.n ? `General Managers: ${gm.rate ?? '—'}% reply rate (${gm.n} emails) · Used Car Managers: ${ucm.rate ?? '—'}% (${ucm.n} emails).` : 'No emails to contacts with those roles yet.' })
  insights.push({ question: 'How many touches does it normally take before we get a meeting?', enough: tbm.length >= MIN_GROUP,
    answer: tbm.length ? `Median ${median(tbm)} touches (average ${avg(tbm)}) across ${tbm.length} first meetings.` : 'No meetings in this period yet.' })
  const markets = dealershipGroups(contacted, 'market').filter(r => r.key !== '—')
  const bestMarket = [...markets].filter(r => r.enough).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0]
  insights.push({ question: 'Which markets have the highest close rate?', enough: !!bestMarket,
    answer: bestMarket ? `${bestMarket.key}: ${bestMarket.winRate}% of ${bestMarket.n} contacted dealerships won.` : `No market has ${MIN_GROUP}+ contacted dealerships yet.` })
  const em = channels.find(c => c.key === 'email')!, vi = channels.find(c => c.key === 'visit')!
  insights.push({ question: 'Are walk-ins producing more revenue per hour than email prospecting?', enough: em.hours >= 5 && vi.hours >= 5,
    answer: em.hours || vi.hours ? `Walk-ins (incl. driving): ${vi.revenuePerHour == null ? '—' : `$${vi.revenuePerHour.toLocaleString()}`}/hour over ${vi.hours}h · Email: ${em.revenuePerHour == null ? '—' : `$${em.revenuePerHour.toLocaleString()}`}/hour over ${em.hours}h (annual revenue won per hour tracked).` : 'Track time by category to answer this.' })
  const topCh = [...channels].sort((a, b) => b.annualRevenue - a.annualRevenue)[0]!
  insights.push({ question: 'Which activity generated the most annual revenue?', enough: winsIn.length >= 3,
    answer: topCh.annualRevenue ? `${topCh.label} — $${topCh.annualRevenue.toLocaleString()} in annual revenue from ${topCh.wins} win${topCh.wins === 1 ? '' : 's'} (credited to the touch that got the meeting).` : 'No won deals with revenue in this period yet.' })

  return {
    base: { contacted: contacted.length, emails: emails.length, meetings: meetingsIn.length, wins: winsIn.length },
    dimension: dim, dimensions: Object.fromEntries(Object.entries(DEALERSHIP_DIMENSIONS).map(([k, v]) => [k, v.label])), byDealership,
    emailDimension: edim, emailDimensions: EMAIL_DIMENSIONS, byEmail,
    channels, touchesToMeeting: { median: median(tbm), average: avg(tbm), n: tbm.length, distribution: touchDist },
    insights, minGroup: MIN_GROUP,
  }
}
