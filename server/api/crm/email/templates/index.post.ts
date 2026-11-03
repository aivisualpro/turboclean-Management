import { actorFromSession, getCrmDb } from '../../../../utils/crm'
import { createTemplate } from '../../../../utils/crm-email'
import { getUserSession } from '../../../../utils/auth'

/** POST /api/crm/email/templates — { name, category, description, subject, format, body | html, label, note, studio? } */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const body = (await readBody(event)) || {}
  const db = await getCrmDb()
  const actor = actorFromSession(session)
  const template = await createTemplate(db, body, actor)
  if (body.studio) {
    const { recordSignal } = await import('../../../../utils/brain')
    await recordSignal(db, 'design.saved', 'design', { name: body.name, brief: String(body.studio.brief || '').slice(0, 1500), turns: Number(body.studio.turns) || 0 }, { actor, refId: template?.id || null })
  }
  return { template }
})
