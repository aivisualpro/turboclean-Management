/**
 * Daily & Weekly invoice automation engine.
 *
 * An automation is a standing order: on its schedule it sweeps uninvoiced
 * work orders into Daily invoices (and, for weekly automations, rolls
 * completed weeks into Weekly invoices), then emails everything that's
 * ready to the dealer's invoice contacts and/or custom recipients.
 *
 * Guarantees:
 *  - At most ONE run per automation per calendar day (claim on lastRunKey),
 *    so overlapping schedulers/processes can never double-send.
 *  - Already-emailed invoices are never re-sent (only Draft invoices inside
 *    a bounded date window are delivered).
 *  - Every run is recorded in turboCleanAutomationRuns for full auditability.
 *
 * Collections: turboCleanInvoiceAutomations, turboCleanAutomationRuns
 */

import { ObjectId } from 'mongodb'
import { nowInTimezone } from './monthly-automation'
import { generateDailyInvoices, generateWeeklyRollups } from './invoice-generation'
import { dealerInvoiceRecipients, defaultInvoiceSubject, sendInvoiceByEmail } from './invoice-email'

export const AUTOMATIONS_COLLECTION = 'turboCleanInvoiceAutomations'
export const RUNS_COLLECTION = 'turboCleanAutomationRuns'

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DAILY_DELIVERY_LOOKBACK_DAYS = 13 // catch late work orders without resurrecting ancient drafts
const WEEKLY_DELIVERY_LOOKBACK_DAYS = 35 // up to 5 completed weeks of backlog

function pad(n: number) { return String(n).padStart(2, '0') }
function dateStrFromUTC(d: Date) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }

/** Civil "today" in the automation's timezone, plus derived helpers */
export function civilNow(tz: string) {
  const now = nowInTimezone(tz || 'America/New_York')
  const todayUTC = new Date(Date.UTC(now.year, now.month - 1, now.day))
  const weekdayName = WEEKDAY_NAMES[todayUTC.getUTCDay()] as string
  // Monday-start of the current civil week (ISO)
  const dow = todayUTC.getUTCDay() || 7
  const weekStartUTC = new Date(todayUTC.getTime() - (dow - 1) * 86400000)
  // Offset between civil time and real time (minute precision, DST-aware "right now")
  const civilNowMs = Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute)
  const offsetMs = civilNowMs - Date.now()
  return { ...now, todayUTC, todayStr: dateStrFromUTC(todayUTC), weekdayName, weekStartUTC, offsetMs }
}

function parseTime(t: string): { h: number, m: number } {
  const [h, m] = (t || '09:00').split(':').map(Number)
  return { h: h || 0, m: m || 0 }
}

/** A run is considered crashed (and reclaimable) after this long stuck in 'Running' */
const STALE_RUNNING_MS = 15 * 60_000

function scheduledDayMatches(a: any, weekdayName: string): boolean {
  if (a.frequency === 'weekly') return (a.weekday || 'Monday') === weekdayName
  const runDays: string[] = Array.isArray(a.runDays) && a.runDays.length > 0 ? a.runDays : WEEKDAY_NAMES
  return runDays.includes(weekdayName)
}

/**
 * Most recent scheduled day (as YYYY-MM-DD) whose fire time has already
 * passed, looking back up to 6 days. This is what makes automations
 * CATCH UP: if the server was off on the scheduled day, the next tick on a
 * later day still owes that run (the delivery windows cover the backlog).
 */
export function latestOwedRunDay(a: any, c: ReturnType<typeof civilNow>): string | null {
  const { h, m } = parseTime(a.time)
  const createdMs = a.createdAt ? new Date(a.createdAt).getTime() : 0

  for (let i = 0; i <= 6; i++) {
    const day = new Date(c.todayUTC.getTime() - i * 86400000)
    const weekdayName = WEEKDAY_NAMES[day.getUTCDay()] as string
    if (!scheduledDayMatches(a, weekdayName)) continue
    if (i === 0) {
      const nowMinutes = c.hour * 60 + c.minute
      if (nowMinutes < h * 60 + m) continue // today's slot not reached yet — check for missed earlier days
    }
    // A slot that fired before the automation existed is not owed — a freshly
    // created automation starts at its NEXT slot instead of surprise-sending
    // immediately (use Run Now to fire it on demand).
    if (createdMs) {
      const fireMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m) - c.offsetMs
      if (fireMs < createdMs) return null
    }
    return dateStrFromUTC(day)
  }
  return null
}

/** Is this automation due right now? (schedule gating — the claim handles races) */
export function isAutomationDue(a: any, c: ReturnType<typeof civilNow>): { due: boolean, reason: string } {
  const owedDay = latestOwedRunDay(a, c)
  if (!owedDay) {
    return {
      due: false,
      reason: a.frequency === 'weekly'
        ? `Next run: ${a.weekday || 'Monday'} at ${a.time} (${a.timezone}).`
        : `Scheduled time ${a.time} (${a.timezone}) not reached yet.`,
    }
  }

  if ((a.lastRunKey || '') >= owedDay) {
    // Already covered — unless that run crashed mid-flight and is stale
    const staleRunning = a.lastRunStatus === 'Running'
      && a.lastRunAt
      && a.lastRunAt < new Date(Date.now() - STALE_RUNNING_MS).toISOString()
    if (!staleRunning) {
      return { due: false, reason: `Already ran for ${a.lastRunKey}.` }
    }
    return { due: true, reason: 'Previous run appears crashed — retrying.' }
  }

  return { due: true, reason: '' }
}

/** Next scheduled fire, as a real timestamp + display pieces (for the UI) */
export function computeNextRun(a: any): { at: string, dateStr: string, weekday: string } | null {
  if (!a.enabled) return null
  const c = civilNow(a.timezone || 'America/New_York')
  const { h, m } = parseTime(a.time)

  // Owed right now (or catching up)? It fires on the next scheduler tick.
  const { due } = isAutomationDue(a, c)
  if (due) {
    return { at: new Date().toISOString(), dateStr: c.todayStr, weekday: c.weekdayName }
  }

  for (let i = 0; i <= 14; i++) {
    const day = new Date(c.todayUTC.getTime() + i * 86400000)
    const dayStr = dateStrFromUTC(day)
    const weekday = WEEKDAY_NAMES[day.getUTCDay()] as string

    if (a.endDate && dayStr > a.endDate) return null
    if (!scheduledDayMatches(a, weekday)) continue

    if (i === 0) {
      const nowMinutes = c.hour * 60 + c.minute
      if ((a.lastRunKey || '') >= c.todayStr) continue // already covered today
      if (nowMinutes >= h * 60 + m) continue // time already passed (would have run)
    }

    // Note: uses today's UTC offset — display can be ±1h across a DST switch,
    // but actual firing is gated in civil time and stays exact.
    const atMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m) - c.offsetMs
    return { at: new Date(atMs).toISOString(), dateStr: dayStr, weekday }
  }
  return null
}

/** Fill {number} {dealer} {date} {total} {type} tokens in a custom subject */
export function renderSubjectTemplate(tpl: string, invoice: any): string {
  if (!tpl) return ''
  const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`
  return tpl.replace(/\{(number|dealer|date|total|type)\}/gi, (match, key) => {
    switch (key.toLowerCase()) {
      case 'number': return invoice.number || match
      case 'dealer': return invoice.dealerName || match
      case 'date': return invoice.date || match
      case 'total': return money(invoice.total)
      case 'type': return invoice.type || match
      default: return match
    }
  })
}

/** Human summary of the schedule, e.g. "Every day · 07:00 (New York) · bills previous day" */
export function scheduleSentence(a: any): string {
  const tzShort = (a.timezone || 'America/New_York').split('/')[1]?.replace(/_/g, ' ') || a.timezone
  if (a.frequency === 'weekly') {
    return `Every ${a.weekday || 'Monday'} · ${a.time} (${tzShort}) · bills the completed prior week`
  }
  const runDays: string[] = Array.isArray(a.runDays) && a.runDays.length > 0 ? a.runDays : WEEKDAY_NAMES
  const daysLabel = runDays.length === 7
    ? 'Every day'
    : runDays.length === 5 && !runDays.includes('Saturday') && !runDays.includes('Sunday')
      ? 'Weekdays'
      : runDays.map(d => d.slice(0, 3)).join(', ')
  return `${daysLabel} · ${a.time} (${tzShort}) · bills ${a.billingDay === 'same' ? 'same day' : 'previous day'}`
}

/**
 * Execute one automation end-to-end. Never throws — always returns a summary
 * and records the run in turboCleanAutomationRuns.
 */
export async function runInvoiceAutomation(
  db: any,
  automation: any,
  opts: { trigger: 'schedule' | 'manual' },
): Promise<{ success: boolean, status: string, summary: string, run: any }> {
  const automationsCol = db.collection(AUTOMATIONS_COLLECTION)
  const runsCol = db.collection(RUNS_COLLECTION)
  const invoicesCol = db.collection('turboCleanInvoices')

  const startedAt = new Date()
  const c = civilNow(automation.timezone || 'America/New_York')
  const frequency = automation.frequency === 'weekly' ? 'weekly' : 'daily'
  const scoped = automation.dealerScope === 'selected' && Array.isArray(automation.dealerIds) && automation.dealerIds.length > 0
  const dealerIds: string[] | undefined = scoped ? automation.dealerIds.map(String) : undefined

  const run: any = {
    automationId: automation._id.toString(),
    automationName: automation.name || '',
    frequency,
    trigger: opts.trigger,
    startedAt,
    finishedAt: null,
    status: 'Running',
    dailiesGenerated: 0,
    weekliesGenerated: 0,
    invoicesEmailed: 0,
    emailsSent: 0,
    emailsFailed: 0,
    skippedNoRecipients: 0,
    invoiceNumbers: [] as string[],
    errors: [] as { invoice?: string, error: string }[],
  }

  const stamp = {
    automationId: automation._id.toString(),
    automationName: automation.name || '',
    generatedByAutomation: true,
  }

  try {
    // ── 1. Sweep uninvoiced work orders into Daily invoices ──────────────
    const daily = await generateDailyInvoices(db, { dealerIds, stamp })
    run.dailiesGenerated = daily.generated

    // ── 2. Weekly automations also roll completed weeks up ───────────────
    if (frequency === 'weekly') {
      const weekly = await generateWeeklyRollups(db, {
        dealerIds,
        completedBefore: c.weekStartUTC, // never bill the week still in progress
        stamp,
      })
      run.weekliesGenerated = weekly.generated
    }

    // ── 3. Collect deliverable Draft invoices in the billing window ──────
    let deliverables: any[] = []
    let windowStartStr = ''
    if (frequency === 'daily') {
      const billingDayUTC = automation.billingDay === 'same'
        ? c.todayUTC
        : new Date(c.todayUTC.getTime() - 86400000)
      const billingDayStr = dateStrFromUTC(billingDayUTC)
      windowStartStr = dateStrFromUTC(new Date(billingDayUTC.getTime() - DAILY_DELIVERY_LOOKBACK_DAYS * 86400000))

      const q: any = {
        type: 'Daily',
        status: 'Draft',
        date: { $gte: windowStartStr, $lte: billingDayStr },
        'lineItems.0': { $exists: true },
      }
      if (dealerIds) q.dealerId = { $in: dealerIds }
      deliverables = await invoicesCol.find(q).toArray()
    }
    else {
      const weekStartStr = dateStrFromUTC(c.weekStartUTC)
      windowStartStr = dateStrFromUTC(new Date(c.weekStartUTC.getTime() - WEEKLY_DELIVERY_LOOKBACK_DAYS * 86400000))

      const q: any = {
        type: 'Weekly',
        status: 'Draft',
        customStartDate: { $exists: false }, // custom-range invoices stay manual
        date: { $gte: windowStartStr, $lt: weekStartStr },
        'lineItems.0': { $exists: true },
      }
      if (dealerIds) q.dealerId = { $in: dealerIds }
      deliverables = await invoicesCol.find(q).toArray()
    }

    // ── 4. Deliver ────────────────────────────────────────────────────────
    if (automation.autoSend === false) {
      run.status = 'Success'
      run.summary = `${run.dailiesGenerated + run.weekliesGenerated} invoice(s) generated · delivery off (drafts only)`
    }
    else {
      // Dealer contact lookup for recipient resolution
      const dealerDocs = new Map<string, any>()
      const uniqueDealerIds = [...new Set(deliverables.map(inv => String(inv.dealerId)))]
      if (uniqueDealerIds.length > 0) {
        const variants: any[] = []
        for (const id of uniqueDealerIds) {
          variants.push(id)
          try { variants.push(new ObjectId(id)) } catch {}
        }
        const docs = await db.collection('turboCleanDealers').find({ _id: { $in: variants } }).toArray()
        for (const d of docs) dealerDocs.set(d._id.toString(), d)
      }

      const customEmails: string[] = (automation.emails || [])
        .map((e: string) => (e || '').trim().replace(/,+$/, ''))
        .filter(Boolean)

      // Heartbeat: long delivery loops refresh lastRunAt so the 15-minute
      // stale-run reclaim never steals a run that's alive and still working.
      let lastHeartbeat = Date.now()

      for (const invoice of deliverables) {
        if (Date.now() - lastHeartbeat > 4 * 60_000) {
          lastHeartbeat = Date.now()
          await automationsCol.updateOne(
            { _id: automation._id },
            { $set: { lastRunAt: new Date().toISOString() } },
          ).catch(() => {})
        }
        const recipients = new Set<string>(customEmails)
        if (automation.useDealerContacts !== false) {
          for (const e of dealerInvoiceRecipients(dealerDocs.get(String(invoice.dealerId)))) recipients.add(e)
        }

        if (recipients.size === 0) {
          run.skippedNoRecipients++
          run.errors.push({ invoice: invoice.number, error: 'No recipients (no receiveInvoices contacts on dealer, no custom emails)' })
          continue
        }

        const result = await sendInvoiceByEmail(db, invoice, [...recipients], {
          subject: automation.emailSubject
            ? renderSubjectTemplate(automation.emailSubject, invoice)
            : defaultInvoiceSubject(invoice),
          emailBody: automation.emailBody,
          sentByAutomation: opts.trigger === 'schedule',
          automationId: automation._id.toString(),
        })

        if (result.success) {
          run.invoicesEmailed++
          run.emailsSent += result.emailsSent
          run.invoiceNumbers.push(invoice.number)
        }
        else {
          run.emailsFailed++
          run.errors.push({ invoice: invoice.number, error: result.error || 'Send failed' })
        }

        // Pace sends to stay under the email provider's rate limits
        await new Promise(resolve => setTimeout(resolve, 650))
      }

      if (deliverables.length === 0) {
        run.status = 'Success'
        run.summary = run.dailiesGenerated + run.weekliesGenerated > 0
          ? `${run.dailiesGenerated + run.weekliesGenerated} invoice(s) generated · nothing due for delivery`
          : 'Nothing to do — no new work orders, no invoices due'
      }
      else if (run.invoicesEmailed === deliverables.length - run.skippedNoRecipients && run.emailsFailed === 0 && run.skippedNoRecipients === 0) {
        run.status = 'Success'
        run.summary = `${run.invoicesEmailed} invoice(s) emailed to ${run.emailsSent} recipient(s)`
      }
      else if (run.invoicesEmailed > 0) {
        run.status = 'Partial'
        run.summary = `${run.invoicesEmailed}/${deliverables.length} invoice(s) emailed · ${run.emailsFailed} failed · ${run.skippedNoRecipients} without recipients`
      }
      else {
        run.status = 'Failed'
        run.summary = run.skippedNoRecipients > 0 && run.emailsFailed === 0
          ? `${run.skippedNoRecipients} invoice(s) had no recipients — add receiveInvoices contacts or custom emails`
          : `Delivery failed for all ${deliverables.length} invoice(s)`
      }
    }

    // Operator signal: drafts older than the delivery window are never
    // auto-sent — say so instead of silently ignoring them.
    try {
      const staleQ: any = frequency === 'daily'
        ? { type: 'Daily', status: 'Draft', date: { $lt: windowStartStr }, 'lineItems.0': { $exists: true } }
        : { type: 'Weekly', status: 'Draft', customStartDate: { $exists: false }, date: { $lt: windowStartStr }, 'lineItems.0': { $exists: true } }
      if (dealerIds) staleQ.dealerId = { $in: dealerIds }
      const staleCount = await invoicesCol.countDocuments(staleQ)
      if (staleCount > 0) {
        run.staleDrafts = staleCount
        run.summary += ` · ${staleCount} older draft(s) outside the delivery window — review them under Invoices`
      }
    }
    catch {}
  }
  catch (err: any) {
    console.error(`[Invoice Automation] "${automation.name}" crashed:`, err)
    run.status = 'Failed'
    run.summary = `Run crashed: ${err.message}`
    run.errors.push({ error: err.message })
  }

  run.finishedAt = new Date()

  // ── 5. Record the run + update automation bookkeeping ───────────────────
  await runsCol.insertOne(run).catch((e: any) => console.error('[Invoice Automation] Failed to record run:', e?.message))

  await automationsCol.updateOne(
    { _id: automation._id },
    {
      $set: {
        lastRunAt: startedAt.toISOString(),
        lastRunStatus: run.status,
        lastRunSummary: run.summary,
        updatedAt: new Date().toISOString(),
      },
      $inc: { runsCount: 1 },
    },
  ).catch(() => {})

  return { success: run.status === 'Success' || run.status === 'Partial', status: run.status, summary: run.summary, run }
}

/**
 * Self-gating processor — safe to call as often as you like (the in-app
 * scheduler pings it every minute; an external cron can too). Each enabled
 * automation fires at most once per calendar day, claimed atomically.
 */
export async function processDueInvoiceAutomations(
  db: any,
  opts: { force?: boolean, automationId?: string } = {},
): Promise<{ processed: number, results: any[] }> {
  const automationsCol = db.collection(AUTOMATIONS_COLLECTION)

  const query: any = opts.automationId
    ? { _id: (() => { try { return new ObjectId(opts.automationId) } catch { return opts.automationId } })() }
    : { enabled: true }

  const automations = await automationsCol.find(query).toArray()
  const results: any[] = []
  let processed = 0

  for (const automation of automations) {
    const label = automation.name || automation._id.toString()

    // One broken automation (bad timezone, corrupt doc) must never stall the rest
    try {
      const c = civilNow(automation.timezone || 'America/New_York')

      // End date reached → auto-disable
      if (automation.endDate && automation.endDate < c.todayStr) {
        await automationsCol.updateOne(
          { _id: automation._id },
          { $set: { enabled: false, disabledReason: `End date ${automation.endDate} reached`, updatedAt: new Date().toISOString() } },
        )
        results.push({ automation: label, skipped: true, reason: `End date ${automation.endDate} reached — automation disabled.` })
        continue
      }

      if (!opts.force) {
        const { due, reason } = isAutomationDue(automation, c)
        if (!due) {
          results.push({ automation: label, skipped: true, reason })
          continue
        }
      }

      // Atomic claim: exactly one process wins this run. A run stuck in
      // 'Running' for 15+ minutes is treated as crashed and reclaimable.
      const staleIso = new Date(Date.now() - 15 * 60_000).toISOString()
      const notInFlight = {
        $or: [
          { lastRunStatus: { $ne: 'Running' } },
          { lastRunAt: { $lt: staleIso } },
          { lastRunAt: { $in: [null, ''] } },
        ],
      }
      const claimFilter = opts.force
        ? { _id: automation._id, ...notInFlight }
        : {
            _id: automation._id,
            ...notInFlight,
            $and: [{
              $or: [
                { lastRunKey: { $ne: c.todayStr } },
                // same-day reclaim only for crashed runs
                { lastRunKey: c.todayStr, lastRunStatus: 'Running' },
              ],
            }],
          }
      const claim = await automationsCol.updateOne(
        claimFilter as any,
        { $set: { lastRunKey: c.todayStr, lastRunStatus: 'Running', lastRunAt: new Date().toISOString() } },
      )
      if (claim.modifiedCount === 0) {
        results.push({ automation: label, skipped: true, reason: opts.force ? 'A run is already in progress — try again in a moment.' : 'Claimed by another process.' })
        continue
      }

      processed++
      const outcome = await runInvoiceAutomation(db, automation, { trigger: opts.force ? 'manual' : 'schedule' })
      results.push({ automation: label, skipped: false, ...outcome })
    }
    catch (err: any) {
      console.error(`[Invoice Automation] Processing "${label}" failed:`, err)
      results.push({ automation: label, skipped: false, success: false, status: 'Failed', summary: err.message })
      await automationsCol.updateOne(
        { _id: automation._id },
        { $set: { lastRunStatus: 'Failed', lastRunSummary: err.message, updatedAt: new Date().toISOString() } },
      ).catch(() => {})
    }
  }

  return { processed, results }
}
