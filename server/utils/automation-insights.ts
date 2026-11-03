/**
 * Automation 14: which strategies produce contracts.
 *
 * Weekly snapshot built from the CRM's own analytics (crm-analytics.performance) plus what only
 * the automations know: how drafts are treated (approved / edited / skipped), how template vs
 * AI-personalized vs hand-edited emails perform, which follow-up number gets the replies, and
 * how often reply suggestions were right. Optionally Claude turns the numbers into a short
 * "do more of / do less of" list — strictly from the numbers given.
 */
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import { performance } from './crm-analytics'
import { emailDb } from './crm-email'
import { automationDb } from './automation'
import type { AutomationSettings, JobResult } from './automation'
import { aiConfigured, askClaudeJson } from './automation-ai'
import { suggestionAccuracy } from './automation-replies'

const pct = (a: number, b: number) => b ? Math.round((a / b) * 1000) / 10 : null
const MIN = 10

interface Finding { kind: 'do_more' | 'do_less' | 'info', title: string, detail: string, enough: boolean }

/** Best and worst groups of one analytics dimension, by win rate then meeting rate. */
function extremes(rows: any[], label: string): Finding[] {
  const ok = rows.filter(r => r.enough && r.key !== '—' && r.key !== 'Not audited')
  if (ok.length < 2) return []
  const by = (r: any) => (r.winRate ?? 0) * 1000 + (r.meetingRate ?? 0)
  const best = [...ok].sort((a, b) => by(b) - by(a))[0]
  const worst = [...ok].sort((a, b) => by(a) - by(b))[0]
  const out: Finding[] = []
  if (best && (best.won || best.meeting)) out.push({ kind: 'do_more', enough: true, title: `${label}: ${best.key}`, detail: `${best.winRate ?? 0}% won, ${best.meetingRate ?? 0}% got a meeting (${best.n} dealerships${best.revenuePerHour ? `, $${best.revenuePerHour.toLocaleString()}/hour` : ''}).` })
  if (worst && worst.key !== best?.key && (worst.meetingRate ?? 0) < (best?.meetingRate ?? 0)) out.push({ kind: 'do_less', enough: true, title: `${label}: ${worst.key}`, detail: `${worst.winRate ?? 0}% won, ${worst.meetingRate ?? 0}% got a meeting (${worst.n} dealerships).` })
  return out
}

export async function automationStats(db: Db, sinceIso?: string) {
  const { drafts } = await automationDb(db)
  const { emails } = await emailDb(db)
  const match: any = sinceIso ? { createdAt: { $gte: sinceIso } } : {}
  const all = await drafts.find(match, { projection: { status: 1, kind: 1, writtenBy: 1, edited: 1, sentEmailId: 1, followUpNumber: 1, rejectReason: 1 } }).toArray()
  const sent = all.filter(d => d.status === 'sent' && d.sentEmailId && ObjectId.isValid(d.sentEmailId))
  const em = sent.length ? await emails.find({ _id: { $in: sent.map(d => new ObjectId(d.sentEmailId)) } }, { projection: { repliedAt: 1, replySentiment: 1, outcomes: 1, followUpNumber: 1 } }).toArray() : []
  const emBy = new Map(em.map(e => [e._id.toString(), e]))
  const style = (d: any) => d.edited ? 'Edited by you' : d.writtenBy === 'ai' ? 'AI-personalized' : 'Template as designed'
  const groups = new Map<string, { n: number, replied: number, positive: number, meetings: number, won: number }>()
  const fu = new Map<number, { n: number, replied: number }>()
  for (const d of sent) {
    const e = emBy.get(d.sentEmailId)
    const g = groups.get(style(d)) || { n: 0, replied: 0, positive: 0, meetings: 0, won: 0 }
    g.n++
    if (e?.repliedAt) g.replied++
    if (e?.replySentiment === 'positive') g.positive++
    if (e?.outcomes?.meeting) g.meetings++
    if (e?.outcomes?.won) g.won++
    groups.set(style(d), g)
    const k = d.followUpNumber || 0
    const f = fu.get(k) || { n: 0, replied: 0 }
    f.n++
    if (e?.repliedAt) f.replied++
    fu.set(k, f)
  }
  const reasons = new Map<string, number>()
  for (const d of all.filter(x => x.status === 'rejected')) reasons.set(d.rejectReason || 'Skipped', (reasons.get(d.rejectReason || 'Skipped') || 0) + 1)
  const decided = all.filter(d => ['sent', 'approved', 'rejected', 'failed'].includes(d.status))
  return {
    drafts: { created: all.length, pending: all.filter(d => d.status === 'pending').length, sent: sent.length, rejected: all.filter(d => d.status === 'rejected').length, cancelled: all.filter(d => d.status === 'cancelled').length, failed: all.filter(d => d.status === 'failed').length,
      approvalRate: pct(decided.filter(d => d.status !== 'rejected').length, decided.length), editRate: pct(all.filter(d => d.edited && d.status === 'sent').length, sent.length) },
    byStyle: [...groups.entries()].map(([key, g]) => ({ key, ...g, replyRate: pct(g.replied, g.n), positiveRate: pct(g.positive, g.n), meetingRate: pct(g.meetings, g.n), enough: g.n >= 20 })),
    byFollowUp: [...fu.entries()].sort((a, b) => a[0] - b[0]).map(([n, f]) => ({ key: n === 0 ? 'First email' : `Follow-up ${n}`, ...f, replyRate: pct(f.replied, f.n), enough: f.n >= 20 })),
    skipReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
    replySuggestions: await suggestionAccuracy(db),
  }
}

export async function buildInsights(db: Db) {
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const [allTime, recent] = await Promise.all([performance(db, {}), performance(db, { from: since90 })])
  const findings: Finding[] = []
  for (const dim of ['leadSource', 'missingPhotos', 'size', 'contactRole', 'firstTouch', 'market', 'outreachMode'] as const) {
    const res = dim === allTime.dimension ? allTime : await performance(db, { dimension: dim })
    findings.push(...extremes(res.byDealership, res.dimensions[dim] || dim))
  }
  const ch = [...allTime.channels].filter((c: any) => c.touches >= MIN).sort((a: any, b: any) => (b.revenuePerHour ?? 0) - (a.revenuePerHour ?? 0))
  if (ch[0]?.revenuePerHour) findings.push({ kind: 'do_more', enough: true, title: `Channel: ${ch[0].label}`, detail: `$${ch[0].revenuePerHour.toLocaleString()} annual revenue per hour; ${ch[0].meetings} meetings from ${ch[0].touches} touches.` })
  const auto = await automationStats(db)
  const styles = auto.byStyle.filter(s => s.enough).sort((a, b) => (b.positiveRate ?? 0) - (a.positiveRate ?? 0))
  if (styles.length >= 2) findings.push({ kind: 'do_more', enough: true, title: `Email style: ${styles[0]!.key}`, detail: `${styles[0]!.positiveRate}% positive replies vs ${styles[styles.length - 1]!.positiveRate}% for ${styles[styles.length - 1]!.key}.` })
  const fuRows = auto.byFollowUp.filter(f => f.enough && f.key !== 'First email')
  const lastUseful = [...fuRows].reverse().find(f => (f.replyRate ?? 0) >= 2)
  if (fuRows.length && lastUseful) findings.push({ kind: 'info', enough: true, title: 'Follow-ups', detail: `Replies still come in up to ${lastUseful.key.toLowerCase()} (${lastUseful.replyRate}% reply rate).` })

  let aiSummary: { doMore: string[], doLess: string[], model: string } | null = null
  if (aiConfigured() && findings.length) {
    const res = await askClaudeJson<{ doMore: string[], doLess: string[] }>({
      system: 'You are a sales-operations analyst. Using ONLY the numbers provided, say what this team should do more of and less of to win more dealership contracts. Short, concrete, no invented numbers. If a sample is small, say so.',
      prompt: `Findings:\n${findings.map(f => `- [${f.kind}] ${f.title}: ${f.detail}`).join('\n')}\n\nStanding questions:\n${allTime.insights.map((i: any) => `- ${i.question} → ${i.answer}${i.enough ? '' : ' (small sample)'}`).join('\n')}\n\nReturn {"doMore": up to 3 strings, "doLess": up to 3 strings}.`,
      maxTokens: 500,
    })
    if (res) aiSummary = { doMore: (res.data.doMore || []).slice(0, 3).map(String), doLess: (res.data.doLess || []).slice(0, 3).map(String), model: res.model }
  }
  return {
    generatedAt: new Date().toISOString(),
    base: { allTime: allTime.base, last90: recent.base },
    questions: allTime.insights,
    questions90: recent.insights,
    channels: allTime.channels,
    touchesToMeeting: allTime.touchesToMeeting,
    findings,
    automation: auto,
    aiSummary,
  }
}

export async function strategyJob(db: Db, _ctx: { settings: AutomationSettings }): Promise<JobResult> {
  const { insights } = await automationDb(db)
  const doc = await buildInsights(db)
  await insights.insertOne({ ...doc })
  const strong = doc.findings.filter(f => f.kind === 'do_more').length
  return { summary: `Weekly strategy report: ${doc.base.allTime.wins} wins analysed, ${strong} thing${strong === 1 ? '' : 's'} to do more of${doc.aiSummary ? ' (with AI summary)' : ''}`, stats: { findings: doc.findings.length, wins: doc.base.allTime.wins } }
}

export async function latestInsights(db: Db) {
  const { insights } = await automationDb(db)
  const doc = await insights.find({}).sort({ generatedAt: -1 }).limit(1).next()
  return doc ? { id: doc._id.toString(), ...doc, _id: undefined } : null
}
