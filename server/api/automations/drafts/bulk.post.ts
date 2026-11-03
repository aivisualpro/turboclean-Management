import { getCrmDb, str } from '../../../utils/crm'
import { approveDraft, rejectDraft } from '../../../utils/automation-outreach'
import { requireActor } from '../../../utils/automation-http'

/** POST /api/automations/drafts/bulk { ids: string[], action: 'approve'|'reject', reason? } */
export default defineEventHandler(async (event) => {
  const actor = await requireActor(event)
  const body = (await readBody(event)) || {}
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map((x: any) => str(x, 64)).filter(Boolean).slice(0, 200) : []
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'Select at least one draft' })
  const db = await getCrmDb()
  const results: any[] = []
  for (const id of ids) {
    try {
      if (body.action === 'reject') results.push({ id, ok: true, draft: await rejectDraft(db, id, str(body.reason, 300), actor) })
      else { const r = await approveDraft(db, id, actor); results.push({ id, ok: true, sent: r.sent, message: r.message }) }
    }
    catch (e: any) { results.push({ id, ok: false, error: e?.statusMessage || e?.message }) }
  }
  return { results, sent: results.filter(r => r.sent).length, queued: results.filter(r => r.ok && body.action !== 'reject' && !r.sent).length, failed: results.filter(r => !r.ok).length }
})
